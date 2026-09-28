import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import type { DocumentDetail, DocumentVersion, SaveResult } from '../../../shared/admin'
import type { Locale } from '../../../shared/protocol'
import { chunkMarkdown } from '../../../shared/chunker'
import type { Chunk } from '../../../shared/chunker'
import { IconArrowUpRight, IconClose } from '../../graphics/icons'
import { api, download, fmtDate } from '../api'
import { lineDiff } from '../../../shared/diff'
import { Notice, Seg, Tag, errorText, href } from '../ui'

/* ============================================================
   Редактор документа. Справа — живое превью нарезки тем же
   shared/chunker, что работает на сервере: подсвеченные фрагменты
   — ровно те, чьи эмбеддинги пересчитаются при сохранении.
   ============================================================ */

const PLACEHOLDER: Record<Locale, string> = {
  ru: 'Впишите ответ.',
  uz: 'Javobni yozing.',
}

/** Раздел FAQ под вопрос из «Пробелов базы». */
const withQuestion = (body: string, question: string, locale: Locale) =>
  `${body.trimEnd()}\n\n## ${question.trim().replace(/\s+/g, ' ')}\n\n${PLACEHOLDER[locale]}\n`

/** Ключ фрагмента = то, из чего сервер считает хеш эмбеддинга. */
const chunkKey = (c: Chunk) => `${c.sourceLabel}\n${c.text}`

export function saveMessage(res: SaveResult): string {
  if (res.indexError) {
    return `Текст сохранён (v${res.version}), но переиндексация не удалась: ${res.indexError}. Бот пока ищет по старым фрагментам — проверьте ключ эмбеддингов и нажмите «Переиндексировать всё» в разделе «Модели».`
  }
  if (!res.changed) return 'Текст не изменился — новая версия не создана.'
  const idx = res.index
  if (!idx) return `Сохранено как v${res.version}.`
  return `Сохранено как v${res.version}. Индекс обновлён: ${idx.embedded} из ${idx.total} фрагм. пересчитаны моделью эмбеддингов, ${idx.reused} остались как были. Бот уже отвечает по новой версии.`
}

interface Props {
  id: number
  /** Вопрос из «Пробелов базы»: дописать под него раздел. */
  append: string | null
  dirty: RefObject<boolean>
  onSaved: () => void
  onDeleted: () => void
}

export function DocEditor({ id, append, dirty, onSaved, onDeleted }: Props) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SaveResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<DocumentVersion | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const appendRef = useRef(append)

  const load = async (resetDraft: boolean) => {
    const d = await api<DocumentDetail>(`/documents/${id}`)
    setDoc(d)
    if (resetDraft) setDraft(d.bodyMd)
    return d
  }

  useEffect(() => {
    let alive = true
    api<DocumentDetail>(`/documents/${id}`).then(
      (d) => {
        if (!alive) return
        setDoc(d)
        // В документ из Drive шаблон не вставляем: он правится только в Drive.
        const q = d.source === 'drive' ? null : appendRef.current
        setDraft(q ? withQuestion(d.bodyMd, q, d.locale) : d.bodyMd)
      },
      (err) => alive && setError(errorText(err)),
    )
    return () => {
      alive = false
    }
  }, [id])

  // Шаблон под вопрос подставлен — выделяем заглушку, чтобы сразу печатать ответ.
  useEffect(() => {
    const ta = textRef.current
    if (!doc || doc.source === 'drive' || !appendRef.current || !ta) return
    appendRef.current = null
    const start = ta.value.lastIndexOf(PLACEHOLDER[doc.locale])
    ta.focus()
    ta.setSelectionRange(start, start + PLACEHOLDER[doc.locale].length)
    ta.scrollTop = ta.scrollHeight
  }, [doc])

  const isDirty = doc !== null && draft !== doc.bodyMd
  useEffect(() => {
    dirty.current = isDirty
  }, [isDirty, dirty])

  const deferred = useDeferredValue(draft)
  const preview = useMemo(() => {
    const savedChunks = chunkMarkdown(doc?.bodyMd ?? '')
    const saved = new Set(savedChunks.map(chunkKey))
    const next = chunkMarkdown(deferred)
    const nextKeys = new Set(next.map(chunkKey))
    // Пропавшие фрагменты. Если на месте такого же раздела появился
    // новый текст — это «изменён», а не «удалён + новый».
    const gone = savedChunks.filter((c) => !nextKeys.has(chunkKey(c)))
    const chunks = next.map((c) => {
      if (saved.has(chunkKey(c))) return { ...c, status: 'same' as const }
      const i = gone.findIndex((g) => g.sourceLabel === c.sourceLabel)
      if (i < 0) return { ...c, status: 'new' as const }
      gone.splice(i, 1)
      return { ...c, status: 'edited' as const }
    })
    return { chunks, removed: gone.length }
  }, [deferred, doc?.bodyMd])
  const edited = preview.chunks.filter((c) => c.status === 'edited').length
  const added = preview.chunks.filter((c) => c.status === 'new').length
  const changedCount = edited + added

  const run = async (action: () => Promise<SaveResult>, resetDraft: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const res = await action()
      setResult(res)
      if (res.changed) setNote('')
      await load(resetDraft)
      onSaved()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    isDirty &&
    !busy &&
    run(() => api<SaveResult>(`/documents/${id}`, { method: 'PUT', body: { bodyMd: draft, note: note || undefined } }), false)

  const rollback = (version: number) => {
    if (isDirty && !confirm('Несохранённые правки пропадут. Откатить?')) return
    setViewing(null)
    run(() => api<SaveResult>(`/documents/${id}/rollback`, { body: { version } }), true)
  }

  const remove = async () => {
    if (!doc || !confirm(`Удалить «${doc.title}» (${doc.locale.toUpperCase()}) вместе с фрагментами и историей версий?`)) return
    try {
      await api(`/documents/${id}`, { method: 'DELETE' })
      onDeleted()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      save()
    }
  }

  if (!doc) return error ? <Notice tone="bad">{error}</Notice> : <p className="muted">Загружаю документ…</p>
  // Документ из Google Drive правится только там: здесь просмотр, нарезка и история.
  const drive = doc.source === 'drive'

  return (
    <div className="stack">
      <header className="editor__head">
        <div>
          <h2 className="editor__title">
            {doc.title} <Tag>{doc.locale.toUpperCase()}</Tag>
          </h2>
          <p className="muted small">
            <code>
              {doc.locale}/{doc.slug}.{drive ? (doc.slug === 'schedule' ? 'xlsx' : 'docx') : 'md'}
            </code>{' '}
            {drive && <Tag tone="accent">Google Drive</Tag>}{' '}
            · v{doc.version} · {doc.chunks} фрагм. в индексе · обновлён {fmtDate(doc.updatedAt)}
          </p>
        </div>
        <div className="editor__head-actions">
          <button
            type="button"
            className="btn btn--quiet btn--small"
            onClick={() => download(`${doc.slug}.${doc.locale}.md`, draft)}
          >
            Скачать .md
          </button>
          {drive ? (
            doc.driveUrl && (
              <a className="btn btn--secondary btn--small" href={doc.driveUrl} target="_blank" rel="noopener">
                Открыть в Google Drive <IconArrowUpRight size={16} />
              </a>
            )
          ) : (
            <button type="button" className="btn btn--quiet btn--small btn--danger" onClick={remove}>
              Удалить
            </button>
          )}
        </div>
      </header>

      {drive && (
        <Notice>
          Источник этого документа — файл в Google Drive. Правьте его там: бот подхватит изменения при следующем вопросе,
          а запись появится в разделе <a href={href('sync')}>«Синхронизация»</a>.
          {append && (
            <>
              {' '}
              Вопрос без ответа, который стоит добавить отдельным разделом: <strong>«{append}»</strong>.
            </>
          )}
        </Notice>
      )}

      {result && <Notice tone={result.indexError ? 'bad' : 'good'}>{saveMessage(result)}</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}

      <div className="editor">
        <label className="field editor__field">
          <span className="field__label">{drive ? 'Текст из Drive (только чтение)' : 'Markdown'}</span>
          <textarea
            readOnly={drive}
            ref={textRef}
            className="input editor__text"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
          />
        </label>

        <section className="editor__preview" aria-label="Превью нарезки">
          <p className="editor__preview-head">
            <strong>{preview.chunks.length} фрагм.</strong>
            {edited > 0 && <Tag tone="accent">{edited} изменено</Tag>}
            {added > 0 && <Tag tone="good">{added} новых</Tag>}
            {preview.removed > 0 && <Tag tone="bad">{preview.removed} удалено</Tag>}
            {changedCount > 0 ? (
              <span className="muted small">— эмбеддинги пересчитаются только у них</span>
            ) : (
              !isDirty && <span className="muted small">как в индексе</span>
            )}
          </p>
          <ol className="chunks">
            {preview.chunks.map((c) => (
              <li key={c.ord} className="chunk" data-changed={c.status !== 'same'}>
                <p className="chunk__head">
                  <span className="chunk__src">{c.sourceLabel}</span>
                  <span className="row__tags">
                    {c.status === 'edited' && <Tag tone="accent">изменён</Tag>}
                    {c.status === 'new' && <Tag tone="good">новый</Tag>}
                    <Tag>{c.kind === 'row' ? 'строка таблицы' : 'раздел'}</Tag>
                  </span>
                </p>
                <p className="chunk__text">{c.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {!drive && (
      <div className="savebar">
        <input
          className="input savebar__note"
          placeholder="Что изменили (необязательно) — попадёт в историю версий"
          aria-label="Комментарий к версии"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="button" className="btn btn--quiet" disabled={!isDirty || busy} onClick={() => setDraft(doc.bodyMd)}>
          Отменить правки
        </button>
        <button type="button" className="btn btn--primary" disabled={!isDirty || busy} onClick={save}>
          {busy ? 'Сохраняю и индексирую…' : isDirty ? `Сохранить · пересчитать ${changedCount}` : 'Сохранено'}
        </button>
      </div>
      )}

      <section className="card panel">
        <h3 className="panel__title">История версий</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Версия</th>
                <th>Когда</th>
                <th>Комментарий</th>
                <th className="num">Размер</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {doc.versions.map((v) => (
                <tr key={v.version}>
                  <td>
                    v{v.version} {v.version === doc.version && <Tag tone="good">текущая</Tag>}
                  </td>
                  <td>{fmtDate(v.createdAt)}</td>
                  <td className="muted">{v.note ?? '—'}</td>
                  <td className="num">{v.size.toLocaleString('ru-RU')} симв.</td>
                  <td className="table__actions">
                    <button type="button" className="btn btn--quiet btn--small" onClick={() => setViewing(v)}>
                      Открыть
                    </button>
                    {v.version !== doc.version && !drive && (
                      <button
                        type="button"
                        className="btn btn--quiet btn--small"
                        disabled={busy}
                        onClick={() => rollback(v.version)}
                      >
                        Откатить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {viewing && (
        <VersionView
          doc={doc}
          version={viewing}
          onClose={() => setViewing(null)}
          onRollback={drive ? null : () => rollback(viewing.version)}
        />
      )}
    </div>
  )
}

function VersionView({
  doc,
  version,
  onClose,
  onRollback,
}: {
  doc: DocumentDetail
  version: DocumentVersion
  onClose: () => void
  /** null — откат недоступен (документ из Google Drive). */
  onRollback: (() => void) | null
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [body, setBody] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'diff' | 'text'>('diff')
  const current = version.version === doc.version

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
    api<{ bodyMd: string }>(`/documents/${doc.id}/versions/${version.version}`).then(
      (r) => setBody(r.bodyMd),
      (err) => setError(errorText(err)),
    )
  }, [doc.id, version.version])

  // Что изменит откат: «−» есть сейчас и пропадёт, «+» вернётся из этой версии.
  const diff = useMemo(() => (body === null ? [] : lineDiff(doc.bodyMd, body)), [body, doc.bodyMd])
  const added = diff.filter((l) => l.op === '+').length
  const removed = diff.filter((l) => l.op === '-').length

  return (
    <dialog ref={ref} className="modal modal--wide" aria-labelledby="version-title" onClose={onClose}>
      <div className="modal__inner">
        <header className="drawer__head">
          <h2 id="version-title" className="drawer__title">
            {doc.title} · v{version.version}
          </h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={() => ref.current?.close()}>
            <IconClose size={20} />
          </button>
        </header>
        <p className="muted small">
          {fmtDate(version.createdAt)}
          {version.note && <> · {version.note}</>}
        </p>

        {!current && (
          <Seg
            label="Вид"
            value={view}
            options={[
              { value: 'diff', label: 'Что изменит откат' },
              { value: 'text', label: 'Текст версии' },
            ]}
            onChange={setView}
          />
        )}

        {error && <Notice tone="bad">{error}</Notice>}
        {body === null ? (
          !error && <p className="muted">Загружаю…</p>
        ) : current || view === 'text' ? (
          <pre className="code-view">{body}</pre>
        ) : added + removed === 0 ? (
          <p className="muted">Текст этой версии совпадает с текущим.</p>
        ) : (
          <>
            <p className="small">
              <Tag tone="bad">−{removed}</Tag> строк пропадёт, <Tag tone="good">+{added}</Tag> вернётся
            </p>
            <DiffView lines={diff} />
          </>
        )}

        <div className="modal__actions">
          {body !== null && (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => download(`${doc.slug}.${doc.locale}.v${version.version}.md`, body)}
            >
              Скачать .md
            </button>
          )}
          {!current && onRollback && (
            <button type="button" className="btn btn--primary" onClick={onRollback}>
              Откатить к v{version.version}
            </button>
          )}
        </div>
      </div>
    </dialog>
  )
}

/** Diff с контекстом: длинные неизменные куски сворачиваются. */
function DiffView({ lines }: { lines: ReturnType<typeof lineDiff> }) {
  const CONTEXT = 2
  const near = lines.map((_, i) =>
    lines.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((l) => l.op !== ' '),
  )
  const out: (ReturnType<typeof lineDiff>[number] | { skip: number })[] = []
  lines.forEach((l, i) => {
    if (near[i]) return out.push(l)
    const last = out[out.length - 1]
    if (last && 'skip' in last) last.skip++
    else out.push({ skip: 1 })
  })

  return (
    <pre className="code-view diff">
      {out.map((l, i) =>
        'skip' in l ? (
          <span key={i} className="diff__skip">
            … {l.skip} строк без изменений
            {'\n'}
          </span>
        ) : (
          <span key={i} className="diff__line" data-op={l.op}>
            {l.op} {l.text}
            {'\n'}
          </span>
        ),
      )}
    </pre>
  )
}
