import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useLocale, useT } from '../../i18n/LocaleContext'
import { fill } from '../../i18n/fill'
import type { Dict } from '../../i18n/types'
import { clinicDate } from '../../../shared/booking'
import type { BookingOffer } from '../../../shared/protocol'
import { PhoneLink } from '../PhoneLink'
import { dayLabel, openBooking } from '../booking/bookingApi'
import {
  IconChat,
  IconClose,
  IconCollapse,
  IconExpand,
  IconFlask,
  IconPhone,
  IconRetry,
  IconSend,
  IconSparkle,
  IconThumbDown,
  IconThumbUp,
} from '../../graphics/icons'
import { AnswerText, CiteCard } from './AnswerText'
import { RetrievalTrace } from './RetrievalTrace'
import { useChat } from './useChat'
import type { ChatMessage, ChatStatus } from './useChat'
import { usePersistentFlag } from './usePersistentFlag'
import './chat.css'

/**
 * Чат-ассистент. Вторая и последняя стеклянная поверхность проекта
 * (функциональный слой, плавает над контентом).
 *
 * Требования references/hig/generative-ai.md, заложенные в UI:
 *  - прямо сказано, что отвечает ИИ, и где его границы (disclosure);
 *  - стартовые подсказки показывают, о чём можно спросить;
 *  - статус ожидания говорит, что происходит, а не «Обработка…»;
 *  - нет ответа в материалах — честный отказ, а не выдумка;
 *  - всегда есть не-ИИ путь: позвонить живому человеку;
 *  - предложенное окно записи — кнопка: чат закрывается, открывается
 *    форма записи с этим врачом и временем (записывает форма, не ИИ);
 *  - отзыв на ответ добровольный и не перебивает разговор.
 *
 * Наглядность RAG (учебная цель проекта):
 *  - над ответом — «Как я нашёл ответ»: найденные фрагменты с оценками;
 *  - сноски [n] в ответе кликабельны и раскрывают цитату из базы;
 *  - отказ объяснён числами: лучшее совпадение против порога;
 *  - режим студента раскрывает всё сразу и даёт спросить ту же
 *    модель без базы знаний, чтобы увидеть разницу.
 */
export function ChatWidget() {
  const t = useT()
  const c = t.chat
  const { locale } = useLocale()
  const chat = useChat(locale)
  const { messages, status, send, retry, isStub } = chat

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [student, setStudent] = usePersistentFlag('skydental.chat.student')
  const [expanded, setExpanded] = usePersistentFlag('skydental.chat.expanded')

  const uid = useId()
  const fabRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  // Прилипание к низу ленты: пока человек внизу, новые слова ответа
  // прокручивают ленту. Отлистал вверх читать трассу — не дёргаем.
  const stickToEnd = useRef(true)

  // Открыли — фокус в поле ввода. Закрыли — фокус обратно на кнопку,
  // чтобы клавиатурный пользователь не потерял место на странице.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) inputRef.current?.focus()
    else if (wasOpen.current) fabRef.current?.focus()
    wasOpen.current = open
  }, [open])

  useLayoutEffect(() => {
    const log = logRef.current
    if (log && stickToEnd.current) log.scrollTop = log.scrollHeight
  }, [messages, status, open])

  function onLogScroll() {
    const log = logRef.current
    if (log) stickToEnd.current = log.scrollHeight - log.scrollTop - log.clientHeight < 64
  }

  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      return
    }
    // Ловушка фокуса: диалог модальный, Tab не уходит под него.
    if (e.key !== 'Tab' || !panelRef.current) return
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  function bookFromChat(offer: BookingOffer) {
    setOpen(false)
    openBooking({ doctorId: offer.doctorId, startsAt: offer.startsAt ?? undefined })
  }

  function ask(text: string) {
    stickToEnd.current = true
    send(text)
  }

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!draft.trim()) return
    ask(draft)
    setDraft('')
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter отправляет, Shift+Enter — перенос строки.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const busy = status === 'searching' || status === 'generating'
  const hasUserMessages = messages.some((m) => m.role === 'user')

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className="chat-fab"
        aria-label={open ? c.fabClose : c.fabOpen}
        aria-expanded={open}
        aria-controls={`${uid}-panel`}
        onClick={() => setOpen((v) => !v)}
        data-open={open}
      >
        {open ? <IconClose size={26} /> : <IconChat size={26} />}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={`${uid}-panel`}
          className="chat glass"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${uid}-title`}
          aria-describedby={`${uid}-disclosure`}
          onKeyDown={onPanelKeyDown}
          data-expanded={expanded}
          data-student={student}
        >
          <header className="chat__head">
            <span className="chat__avatar" aria-hidden="true">
              <IconSparkle size={20} />
            </span>
            <div className="chat__heading">
              <h2 id={`${uid}-title`} className="chat__title">
                {c.title}
              </h2>
              <p className="chat__subtitle">{c.subtitle}</p>
            </div>
            <button
              type="button"
              className="chat__tool"
              aria-pressed={student}
              aria-label={c.studentMode}
              title={student ? c.studentModeOn : c.studentModeOff}
              onClick={() => setStudent(!student)}
            >
              <IconFlask size={20} />
            </button>
            <button
              type="button"
              className="chat__tool chat__tool--expand"
              aria-label={expanded ? c.collapse : c.expand}
              title={expanded ? c.collapse : c.expand}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <IconCollapse size={20} /> : <IconExpand size={20} />}
            </button>
            <button type="button" className="chat__tool" aria-label={c.fabClose} onClick={() => setOpen(false)}>
              <IconClose size={20} />
            </button>
          </header>

          <p id={`${uid}-disclosure`} className="chat__disclosure">
            {c.disclosure}
            {isStub && <span className="chat__stub">{c.stubBadge}</span>}
            {student && <span className="chat__student-note">{c.studentModeOn}</span>}
          </p>

          {/* aria-busy на печатающемся ответе: скринридер прочтёт его
              целиком, когда поток закончится, а не по слову. */}
          <div ref={logRef} className="chat__log" aria-live="polite" onScroll={onLogScroll}>
            <div className="msg msg--assistant">
              <p className="msg__bubble">{c.greeting}</p>
            </div>

            {!hasUserMessages && (
              <div className="chat__suggestions">
                <p className="chat__suggestions-title">{c.suggestionsTitle}</p>
                <div className="chips">
                  {c.suggestions.map((s) => (
                    <button key={s} type="button" className="chip" onClick={() => ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="msg msg--user">
                  <p className="msg__bubble">{m.text}</p>
                </div>
              ) : (
                <AssistantMessage key={m.id} m={m} status={status} student={student} c={c} chat={chat} onBook={bookFromChat} />
              ),
            )}

            {(status === 'error' || status === 'rate-limit') && (
              <div className="msg msg--assistant" role="alert">
                <div className="msg__bubble msg__bubble--error">
                  <p>{status === 'rate-limit' ? c.rateLimited : c.error}</p>
                  <div className="chat__error-actions">
                    {status === 'error' && (
                      <button type="button" className="btn btn--secondary" onClick={retry}>
                        <IconRetry size={18} />
                        {c.retry}
                      </button>
                    )}
                    <PhoneLink className="btn btn--quiet">
                      <IconPhone size={18} />
                      {c.fallbackCall}
                    </PhoneLink>
                  </div>
                </div>
              </div>
            )}
          </div>

          <form className="chat__composer" onSubmit={submit}>
            <label htmlFor={`${uid}-input`} className="sr-only">
              {c.inputLabel}
            </label>
            <textarea
              ref={inputRef}
              id={`${uid}-input`}
              className="chat__input"
              rows={1}
              value={draft}
              placeholder={c.inputPlaceholder}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onInputKeyDown}
              maxLength={500}
            />
            {/* Отправка — главное действие панели, единственная залитая кнопка в ней. */}
            <button type="submit" className="chat__send" aria-label={c.send} disabled={!draft.trim() || busy}>
              <IconSend size={20} />
            </button>
          </form>

          <p className="chat__fallback">
            {c.fallbackTitle} <PhoneLink>{t.contacts.phone}</PhoneLink>
          </p>
        </div>
      )}
    </>
  )
}

/* ---------- Ответ ассистента ---------- */

interface AssistantProps {
  m: ChatMessage
  status: ChatStatus
  student: boolean
  c: Dict['chat']
  chat: ReturnType<typeof useChat>
  onBook: (offer: BookingOffer) => void
}

function AssistantMessage({ m, status, student, c, chat, onBook }: AssistantProps) {
  const [cite, setCite] = useState<number | null>(null)
  const chunks = m.retrieval?.chunks ?? []
  const activeChunk = cite === null ? undefined : chunks.find((ch) => ch.n === cite)
  const toggleCite = (n: number) => setCite((cur) => (cur === n ? null : n))
  const done = !m.streaming && m.meta

  return (
    <div className="msg msg--assistant" aria-busy={m.streaming}>
      {m.retrieval && <RetrievalTrace retrieval={m.retrieval} meta={m.meta} detailed={student} c={c} />}

      {m.streaming && !m.text ? (
        // Слов ещё нет: говорим, на каком шаге RAG мы сейчас.
        <p className="msg__bubble msg__bubble--thinking" role="status">
          <span className="typing" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {status === 'generating' && m.retrieval
            ? fill(c.generating, { n: m.retrieval.chunks.filter((ch) => ch.n !== null).length })
            : c.thinking}
        </p>
      ) : m.notFound ? (
        <div className="msg__bubble msg__bubble--notfound">
          <p>{c.notFound}</p>
          {m.meta?.refusal && (
            <p className="msg__reason">
              {fill(c.refusal[refusalKey(m.meta.refusal.reason)], {
                best: m.meta.refusal.bestScore?.toFixed(2) ?? '—',
                threshold: m.meta.refusal.threshold.toFixed(2),
              })}
            </p>
          )}
          <PhoneLink className="btn btn--secondary chat__call">
            <IconPhone size={18} />
            {c.fallbackCall}
          </PhoneLink>
        </div>
      ) : (
        <div className="msg__bubble" data-streaming={m.streaming}>
          <AnswerText
            text={m.text}
            chunks={chunks}
            active={cite}
            onCite={toggleCite}
            citeLabel={(n, source) => fill(c.citeLabel, { n, source })}
          />
          {activeChunk && <CiteCard chunk={activeChunk} />}
          {done && m.meta!.kind === 'general' && <p className="msg__kind">{c.kind.general}</p>}
          {done && m.meta!.kind === 'missing' && (
            <>
              <p className="msg__kind">{c.kind.missing}</p>
              <PhoneLink className="btn btn--secondary chat__call">
                <IconPhone size={18} />
                {c.fallbackCall}
              </PhoneLink>
            </>
          )}
          {done && m.meta!.sources.length > 0 && (
            <div className="msg__sources">
              <span className="msg__sources-title">
                {m.meta!.kind === 'kb' ? `${c.kind.kb} · ${c.sourcesTitle}` : c.sourcesTitle}
              </span>
              {m.meta!.sources.map((s) => (
                <button
                  key={s.n}
                  type="button"
                  className="source-chip"
                  aria-pressed={cite === s.n}
                  onClick={() => toggleCite(s.n)}
                >
                  <span className="source-chip__n">{s.n}</span>
                  {s.source}
                </button>
              ))}
            </div>
          )}
          {done && !!m.meta!.booking?.length && <BookingOffers offers={m.meta!.booking} c={c} onBook={onBook} />}
        </div>
      )}

      {done && !m.notFound && <FeedbackRow m={m} c={c} chat={chat} />}

      {done && student && !m.compare && (
        <button type="button" className="msg__compare-btn" onClick={() => void chat.compareWithoutRag(m.id)}>
          {c.compareButton}
        </button>
      )}

      {m.compare && (
        <div className="msg__compare" aria-busy={m.compare.streaming}>
          <p className="msg__compare-title">
            {c.compareTitle}
            {m.compare.meta?.model && <code>{m.compare.meta.model}</code>}
          </p>
          {m.compare.failed ? (
            <p>{c.compareFailed}</p>
          ) : m.compare.text ? (
            <AnswerText text={m.compare.text} chunks={[]} active={null} onCite={() => {}} citeLabel={() => ''} />
          ) : (
            <span className="typing" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
          {!m.compare.streaming && !m.compare.failed && <p className="msg__compare-note">{c.compareNote}</p>}
        </div>
      )}
    </div>
  )
}

/** Окна, которые предложил ассистент: кнопка открывает форму записи с этим временем. */
function BookingOffers({ offers, c, onBook }: { offers: BookingOffer[]; c: Dict['chat']; onBook: (o: BookingOffer) => void }) {
  const t = useT()
  const { locale } = useLocale()
  const today = clinicDate(new Date())
  return (
    <div className="msg__book">
      <span className="msg__sources-title">{c.book.title}</span>
      <div className="msg__book-list">
        {offers.map((o) => {
          const day = o.date ? dayLabel(o.date, t.contacts.form, locale, today) : null
          const when = day ? `${day.top}, ${day.bottom} · ${o.time}` : c.book.pick
          return (
            <button
              key={`${o.doctorId}|${o.startsAt}`}
              type="button"
              className="msg__book-btn"
              aria-label={fill(c.book.label, { doctor: o.doctor, when })}
              onClick={() => onBook(o)}
            >
              <span className="msg__book-when">{when}</span>
              <span className="msg__book-doctor">{o.doctor}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function refusalKey(reason: 'below-threshold' | 'no-chunks' | 'model-declined') {
  return ({ 'below-threshold': 'belowThreshold', 'no-chunks': 'noChunks', 'model-declined': 'modelDeclined' } as const)[
    reason
  ]
}

function FeedbackRow({ m, c, chat }: Pick<AssistantProps, 'm' | 'c' | 'chat'>) {
  const [comment, setComment] = useState('')

  if (m.comment === 'open') {
    return (
      <form
        className="msg__comment"
        onSubmit={(e) => {
          e.preventDefault()
          chat.sendComment(m.id, comment)
        }}
      >
        <label className="msg__comment-label">
          {c.feedbackCommentLabel}
          <input
            className="msg__comment-input"
            value={comment}
            maxLength={500}
            placeholder={c.feedbackCommentPlaceholder}
            onChange={(e) => setComment(e.target.value)}
            autoFocus
          />
        </label>
        <div className="msg__comment-actions">
          <button type="submit" className="btn btn--secondary btn--small" disabled={!comment.trim()}>
            {c.feedbackCommentSend}
          </button>
          <button type="button" className="btn btn--quiet btn--small" onClick={() => chat.sendComment(m.id, '')}>
            {c.feedbackCommentSkip}
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="msg__feedback">
      {m.feedback ? (
        <span className="msg__thanks">{c.feedbackThanks}</span>
      ) : (
        <>
          <span className="msg__feedback-label" aria-hidden="true">
            {c.feedbackPrompt}
          </span>
          <button type="button" className="icon-btn" aria-label={c.feedbackUp} onClick={() => chat.setFeedback(m.id, 'up')}>
            <IconThumbUp size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={c.feedbackDown}
            onClick={() => chat.setFeedback(m.id, 'down')}
          >
            <IconThumbDown size={18} />
          </button>
        </>
      )}
    </div>
  )
}
