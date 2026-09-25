import { useEffect, useRef, useState } from 'react'
import type { FormEvent, MouseEvent } from 'react'
import type { DocumentRow, SaveResult } from '../../../shared/admin'
import type { Locale } from '../../../shared/protocol'
import { IconClose } from '../../graphics/icons'
import { api, fmtDate } from '../api'
import { LoadState, Notice, SectionHead, Tag, errorText, go, href, useLoad } from '../ui'
import { DocEditor, saveMessage } from './DocEditor'

/* ============================================================
   База знаний. Источник правды — таблица documents в Neon; md-файлы
   из content/rag — только начальное наполнение (npm run seed).
   Любая правка — новая версия + переиндексация изменённых кусков.
   ============================================================ */

export function Knowledge({ params }: { params: URLSearchParams }) {
  const docs = useLoad<DocumentRow[]>('/documents')
  const docId = Number(params.get('doc')) || null
  const add = params.get('add')
  const addLocale = (params.get('locale') as Locale | null) ?? 'ru'
  const dirty = useRef(false)
  const [creating, setCreating] = useState(false)
  const [flash, setFlash] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  // «Добавить в базу» из пробелов: открыть FAQ нужного языка — шаблон раздела подставит редактор.
  useEffect(() => {
    if (!add || docId || !docs.data) return
    const faq =
      docs.data.find((d) => d.slug === 'faq' && d.locale === addLocale) ?? docs.data.find((d) => d.locale === addLocale)
    if (faq) go('kb', { doc: faq.id, add, locale: addLocale })
  }, [add, addLocale, docId, docs.data])

  // Несохранённые правки не должны теряться молча.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  const guard = (e: MouseEvent) => {
    if (dirty.current && !confirm('Есть несохранённые правки. Уйти без сохранения?')) e.preventDefault()
    else dirty.current = false
  }

  const stale = docs.data?.reduce((s, d) => s + d.stale, 0) ?? 0
  const groups = groupBySlug(docs.data ?? [])

  return (
    <>
      <SectionHead
        title="База знаний"
        lede="Документы, из которых бот берёт ответы. Каждый режется на фрагменты: раздел ## — один фрагмент, строка таблицы — отдельный. Сохранение создаёт новую версию и пересчитывает эмбеддинги только у изменившихся фрагментов."
        actions={
          <>
            <button type="button" className="btn btn--secondary btn--small" onClick={() => setCreating(true)}>
              Новый документ
            </button>
            <a className="btn btn--secondary btn--small" href="/api/admin/export" download>
              Экспорт .zip
            </a>
          </>
        }
      />

      {stale > 0 && (
        <Notice tone="warn">
          {stale} фрагм. проиндексированы другой моделью эмбеддингов — поиск по ним не работает.{' '}
          <a href={href('models')}>Переиндексировать в разделе «Модели»</a>.
        </Notice>
      )}
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}

      <div className="kb">
        <nav className="kb__list card" aria-label="Документы">
          {docs.data ? (
            groups.map(([slug, rows]) => (
              <div key={slug} className="kb__group">
                <p className="kb__slug">
                  <code>{slug}</code>
                </p>
                {rows.map((d) => (
                  <a
                    key={d.id}
                    className="kb__doc"
                    href={href('kb', { doc: d.id })}
                    aria-current={d.id === docId ? 'page' : undefined}
                    onClick={guard}
                  >
                    <span className="kb__doc-title">
                      <Tag>{d.locale.toUpperCase()}</Tag> {d.title}
                    </span>
                    <span className="kb__doc-meta">
                      v{d.version} · {d.chunks} фрагм. · {fmtDate(d.updatedAt)}
                      {d.isPrice && <> · прайс</>}
                      {d.stale > 0 && <Tag tone="warn">устарел индекс</Tag>}
                    </span>
                  </a>
                ))}
              </div>
            ))
          ) : (
            <LoadState loading={docs.loading} error={docs.error} />
          )}
          {docs.data?.length === 0 && (
            <p className="muted small">
              База пуста. Запустите <code>npm run seed</code> или создайте документ.
            </p>
          )}
        </nav>

        <div className="kb__editor">
          {docId ? (
            <DocEditor
              key={docId}
              id={docId}
              append={add}
              dirty={dirty}
              onSaved={docs.reload}
              onDeleted={() => {
                dirty.current = false
                docs.reload()
                setFlash({ tone: 'good', text: 'Документ удалён вместе с фрагментами и историей версий.' })
                go('kb')
              }}
            />
          ) : (
            <div className="empty card">Выберите документ слева — откроется редактор с превью нарезки на фрагменты.</div>
          )}
        </div>
      </div>

      {creating && (
        <NewDocument
          defaultLocale={addLocale}
          onClose={() => setCreating(false)}
          onCreated={(res) => {
            setCreating(false)
            docs.reload()
            setFlash({ tone: res.indexError ? 'bad' : 'good', text: saveMessage(res) })
            go('kb', { doc: res.id })
          }}
        />
      )}
    </>
  )
}

function groupBySlug(rows: DocumentRow[]): [string, DocumentRow[]][] {
  const map = new Map<string, DocumentRow[]>()
  for (const d of rows) map.set(d.slug, [...(map.get(d.slug) ?? []), d])
  return [...map]
}

const TEMPLATE = `# Название документа

## Первый раздел

Текст раздела. Один раздел ## — один фрагмент для поиска, поэтому пишите разделы так, чтобы каждый отвечал на один вопрос.
`

function NewDocument({
  defaultLocale,
  onClose,
  onCreated,
}: {
  defaultLocale: Locale
  onClose: () => void
  onCreated: (res: SaveResult) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [locale, setLocale] = useState<Locale>(defaultLocale)
  const [slug, setSlug] = useState('')
  const [isPrice, setIsPrice] = useState(false)
  const [bodyMd, setBodyMd] = useState(TEMPLATE)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onCreated(await api<SaveResult>('/documents', { body: { locale, slug, bodyMd, isPrice } }))
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className="modal" aria-labelledby="new-doc-title" onClose={onClose}>
      <form className="modal__inner" onSubmit={submit}>
        <header className="drawer__head">
          <h2 id="new-doc-title" className="drawer__title">
            Новый документ
          </h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={() => ref.current?.close()}>
            <IconClose size={20} />
          </button>
        </header>
        <div className="form-row">
          <label className="field">
            <span className="field__label">Язык</span>
            <select className="input" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
              <option value="ru">Русский</option>
              <option value="uz">Oʻzbekcha</option>
            </select>
          </label>
          <label className="field field--grow">
            <span className="field__label">Slug (латиница, цифры, дефис)</span>
            <input
              className="input"
              required
              pattern="[a-z0-9][a-z0-9\-]{0,59}"
              placeholder="warranty"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={isPrice} onChange={(e) => setIsPrice(e.target.checked)} />
          Прайс: поднимать этот документ в выдаче, когда спрашивают о цене
        </label>
        <label className="field">
          <span className="field__label">Текст (markdown)</span>
          <textarea className="input editor__text" rows={12} value={bodyMd} onChange={(e) => setBodyMd(e.target.value)} />
        </label>
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="modal__actions">
          <button type="button" className="btn btn--quiet" onClick={() => ref.current?.close()}>
            Отмена
          </button>
          <button className="btn btn--primary" disabled={busy}>
            {busy ? 'Создаю и индексирую…' : 'Создать'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
