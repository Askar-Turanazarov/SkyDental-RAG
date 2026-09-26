import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { TraceDetail, TraceFilter, TraceList, TraceRow } from '../../../shared/admin'
import type { ChatMode } from '../../../shared/protocol'
import { ru } from '../../i18n/ru'
import { fill } from '../../i18n/fill'
import { AnswerText, CiteCard } from '../../components/chat/AnswerText'
import { RetrievalTrace } from '../../components/chat/RetrievalTrace'
import { IconClose, IconRetry, IconThumbDown, IconThumbUp } from '../../graphics/icons'
import { fmtDate, fmtMs } from '../api'
import { KIND_TAG, LoadState, REFUSAL_LABEL, SectionHead, Seg, Tag, go, href, useLoad } from '../ui'

/* ============================================================
   Диалоги и отзывы: каждая строка — одна трасса RAG. Клик
   открывает её целиком: вопрос, найденные фрагменты с оценками,
   ответ со сносками, модель и попытки fallback, отзыв.
   ============================================================ */

const PAGE = 50

const FILTERS: { value: TraceFilter; label: ReactNode; title?: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'feedback', label: 'С оценкой' },
  { value: 'down', label: <IconThumbDown size={16} />, title: 'Оценка «плохо»' },
  { value: 'up', label: <IconThumbUp size={16} />, title: 'Оценка «хорошо»' },
  { value: 'commented', label: 'С комментарием' },
  { value: 'notfound', label: 'Без ответа' },
]

const MODES: { value: ChatMode | 'all'; label: string }[] = [
  { value: 'all', label: 'Все режимы' },
  { value: 'rag', label: 'RAG' },
  { value: 'no-rag', label: 'Без RAG' },
]

const plain = (text: string) => text.replace(/\*\*/g, '')

export function Traces({ params }: { params: URLSearchParams }) {
  const [filter, setFilter] = useState<TraceFilter>('all')
  const [mode, setMode] = useState<ChatMode | 'all'>('all')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)

  // Новый фильтр — снова с первой страницы.
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v)
      setOffset(0)
    }
  useEffect(() => {
    const t = setTimeout(() => reset(setSearch)(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const query = new URLSearchParams({ filter, q: search, limit: String(PAGE), offset: String(offset) })
  if (mode !== 'all') query.set('mode', mode)
  const { data, error, loading, reload } = useLoad<TraceList>(`/traces?${query}`)
  const openId = params.get('id')

  return (
    <>
      <SectionHead
        title="Диалоги и отзывы"
        lede="Каждая строка — один проход RAG: вопрос → поиск по базе → ответ модели. Откройте строку, чтобы увидеть, какие фрагменты нашлись и почему бот ответил именно так."
        actions={
          <button type="button" className="btn btn--secondary btn--small" onClick={reload}>
            <IconRetry size={16} /> Обновить
          </button>
        }
      />

      <div className="toolbar">
        <Seg label="Фильтр" value={filter} options={FILTERS} onChange={reset(setFilter)} />
        <select
          className="input input--small"
          aria-label="Режим"
          value={mode}
          onChange={(e) => reset(setMode)(e.target.value as ChatMode | 'all')}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <input
          className="input input--small toolbar__grow"
          type="search"
          placeholder="Поиск по вопросу"
          aria-label="Поиск по вопросу"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {data && data.rows.length > 0 ? (
        <>
          <ul className="rows" data-loading={loading}>
            {data.rows.map((r) => (
              <TraceRowItem key={r.id} r={r} />
            ))}
          </ul>
          <div className="pager">
            <span className="muted">
              {offset + 1}–{offset + data.rows.length} из {data.total}
            </span>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
            >
              Назад
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              disabled={offset + PAGE >= data.total}
              onClick={() => setOffset(offset + PAGE)}
            >
              Дальше
            </button>
          </div>
        </>
      ) : (
        <LoadState
          loading={loading}
          error={error}
          empty={
            filter === 'all' && !search
              ? 'Пока ни одного диалога. Задайте боту вопрос на сайте — трасса появится здесь.'
              : 'По этому фильтру ничего нет.'
          }
        />
      )}

      {openId && <TraceDrawer id={openId} onClose={() => go('traces')} />}
    </>
  )
}

function TraceRowItem({ r }: { r: TraceRow }) {
  // Отказ офлайн-модели или сбой: текста ответа нет.
  const failed = !r.answer && r.mode === 'rag'
  return (
    <li>
      <a className="row" href={href('traces', { id: r.id })}>
        <div className="row__main">
          <p className="row__title">{r.question}</p>
          <p className="row__text">
            {failed && r.refusalReason
              ? `Отказ: ${REFUSAL_LABEL[r.refusalReason]}`
              : plain(r.answer) || 'Ответа нет — генерация не удалась'}
          </p>
        </div>
        <div className="row__side">
          <span className="row__tags">
            <Tag>{r.locale.toUpperCase()}</Tag>
            {r.mode === 'no-rag' && <Tag tone="warn">без RAG</Tag>}
            {failed && <Tag tone="bad">{r.refusalReason ? REFUSAL_LABEL[r.refusalReason] : 'сбой'}</Tag>}
            {r.kind && <Tag tone={KIND_TAG[r.kind].tone}>{KIND_TAG[r.kind].label}</Tag>}
            {r.fallback && (
              <Tag tone="warn" title="Первая модель цепочки не ответила — сработал fallback">
                fallback
              </Tag>
            )}
            {r.rating && (
              <Tag tone={r.rating === 'up' ? 'good' : 'bad'} title={r.rating === 'up' ? 'Хорошо' : 'Плохо'}>
                {r.rating === 'up' ? <IconThumbUp size={14} /> : <IconThumbDown size={14} />}
              </Tag>
            )}
            {r.comment && (
              <Tag tone="accent" title={r.comment}>
                комментарий
              </Tag>
            )}
          </span>
          <span className="row__meta">
            {fmtDate(r.createdAt)} · {r.model ?? '—'} · {fmtMs(r.totalMs)}
          </span>
        </div>
      </a>
    </li>
  )
}

const REFUSAL_KEY = {
  'below-threshold': 'belowThreshold',
  'no-chunks': 'noChunks',
  'model-declined': 'modelDeclined',
} as const

function TraceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const { data, error, loading } = useLoad<TraceDetail>(`/traces/${id}`)
  const [active, setActive] = useState<number | null>(null)

  // Модальный <dialog>: фокус внутри, Esc закрывает, фон инертен — бесплатно.
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  useEffect(() => setActive(null), [id])

  const c = ru.chat
  const chunks = data?.retrieval?.chunks ?? []
  const activeChunk = chunks.find((ch) => ch.n === active)
  const refusal = data?.meta.refusal

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="trace-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
    >
      <div className="drawer__inner">
        <header className="drawer__head">
          <h2 id="trace-title" className="drawer__title">
            Трасса ответа
          </h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={() => ref.current?.close()}>
            <IconClose size={20} />
          </button>
        </header>

        {!data ? (
          <LoadState loading={loading} error={error} />
        ) : (
          <div className="drawer__body">
            <p className="row__tags">
              <Tag>{data.locale.toUpperCase()}</Tag>
              <Tag tone={data.mode === 'rag' ? 'accent' : 'warn'}>{data.mode === 'rag' ? 'RAG' : 'без RAG'}</Tag>
              {data.kind ? (
                <Tag tone={KIND_TAG[data.kind].tone}>{KIND_TAG[data.kind].label}</Tag>
              ) : (
                data.mode === 'rag' && (
                  <Tag tone={data.found ? 'good' : 'bad'}>{data.found ? 'ответ найден' : 'отказ'}</Tag>
                )
              )}
              <span className="muted">
                {fmtDate(data.createdAt)} · {fmtMs(data.totalMs)}
              </span>
            </p>

            <div className="msg msg--user">
              <div className="msg__bubble">{data.question}</div>
            </div>

            <div className="msg msg--assistant">
              {data.retrieval ? (
                <RetrievalTrace retrieval={data.retrieval} meta={data.meta} detailed c={c} />
              ) : (
                <p className="muted">
                  Ответ без базы знаний: вопрос задан кнопкой сравнения в режиме студента, поиск не выполнялся.
                </p>
              )}

              {refusal && !data.answer ? (
                <div className="msg__bubble msg__bubble--notfound">
                  <p>{c.notFound}</p>
                  <p className="msg__reason">
                    {fill(c.refusal[REFUSAL_KEY[refusal.reason]], {
                      best: refusal.bestScore?.toFixed(2) ?? '—',
                      threshold: refusal.threshold.toFixed(2),
                    })}
                  </p>
                </div>
              ) : data.answer ? (
                <div className="msg__bubble">
                  <AnswerText
                    text={data.answer}
                    chunks={chunks}
                    active={active}
                    onCite={(n) => setActive(active === n ? null : n)}
                    citeLabel={(n, source) => fill(c.citeLabel, { n, source })}
                  />
                  {activeChunk && <CiteCard chunk={activeChunk} />}
                </div>
              ) : (
                <div className="msg__bubble msg__bubble--error">
                  <p>Модель не ответила: все попытки цепочки завершились ошибкой (см. попытки выше).</p>
                </div>
              )}
            </div>

            {(data.rating || data.comment) && (
              <section className="feedback-box" data-rating={data.rating ?? undefined}>
                <h3 className="feedback-box__title">
                  Отзыв:{' '}
                  {data.rating === 'up' ? (
                    <>
                      <IconThumbUp size={16} /> хорошо
                    </>
                  ) : data.rating === 'down' ? (
                    <>
                      <IconThumbDown size={16} /> плохо
                    </>
                  ) : (
                    'без оценки'
                  )}
                </h3>
                {data.comment && <blockquote className="feedback-box__comment">{data.comment}</blockquote>}
              </section>
            )}

            <p className="muted small">
              ID трассы: <code>{data.id}</code>
            </p>
          </div>
        )}
      </div>
    </dialog>
  )
}
