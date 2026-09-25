import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useLocale, useT } from '../../i18n/LocaleContext'
import {
  IconChat,
  IconClose,
  IconPhone,
  IconRetry,
  IconSend,
  IconSparkle,
  IconThumbDown,
  IconThumbUp,
} from '../../graphics/icons'
import { useChat } from './useChat'
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
 *  - отзыв на ответ добровольный и не перебивает разговор.
 */
export function ChatWidget() {
  const t = useT()
  const c = t.chat
  const { locale } = useLocale()
  const { messages, status, send, retry, setFeedback, isStub } = useChat(locale)

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const uid = useId()
  const fabRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listEndRef = useRef<HTMLDivElement>(null)

  // Открыли — фокус в поле ввода. Закрыли — фокус обратно на кнопку,
  // чтобы клавиатурный пользователь не потерял место на странице.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) inputRef.current?.focus()
    else if (wasOpen.current) fabRef.current?.focus()
    wasOpen.current = open
  }, [open])

  // Новое сообщение или индикатор — прокрутка к концу ленты.
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, status])

  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      return
    }
    // Ловушка фокуса: диалог модальный, Tab не уходит под него.
    if (e.key !== 'Tab' || !panelRef.current) return
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!draft.trim()) return
    send(draft)
    setDraft('')
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter отправляет, Shift+Enter — перенос строки.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const thinking = status === 'thinking'
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
            <button type="button" className="chat__close" aria-label={c.fabClose} onClick={() => setOpen(false)}>
              <IconClose size={20} />
            </button>
          </header>

          <p id={`${uid}-disclosure`} className="chat__disclosure">
            {c.disclosure}
            {isStub && <span className="chat__stub">{c.stubBadge}</span>}
          </p>

          <div className="chat__log" aria-live="polite" aria-relevant="additions">
            <div className="msg msg--assistant">
              <p className="msg__bubble">{c.greeting}</p>
            </div>

            {!hasUserMessages && (
              <div className="chat__suggestions">
                <p className="chat__suggestions-title">{c.suggestionsTitle}</p>
                <div className="chips">
                  {c.suggestions.map((s) => (
                    <button key={s} type="button" className="chip" onClick={() => send(s)}>
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
                <div key={m.id} className="msg msg--assistant">
                  {m.notFound ? (
                    <div className="msg__bubble msg__bubble--notfound">
                      <p>{c.notFound}</p>
                      <a className="btn btn--secondary chat__call" href={`tel:${t.contacts.phoneHref}`}>
                        <IconPhone size={18} />
                        {c.fallbackCall}
                      </a>
                    </div>
                  ) : (
                    <div className="msg__bubble">
                      <p>{m.text}</p>
                      {m.sources && m.sources.length > 0 && (
                        <p className="msg__sources">
                          <span>{c.sourcesTitle}:</span>{' '}
                          {m.sources.map((s, i) => (
                            <span key={i}>
                              {i > 0 && ', '}
                              {s.url ? (
                                <a href={s.url} target="_blank" rel="noopener noreferrer">
                                  {s.title}
                                </a>
                              ) : (
                                s.title
                              )}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                  )}

                  {!m.notFound && (
                    <div className="msg__feedback">
                      {m.feedback ? (
                        <span className="msg__thanks">{c.feedbackThanks}</span>
                      ) : (
                        <>
                          <span className="msg__feedback-label" aria-hidden="true">
                            {c.feedbackPrompt}
                          </span>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={c.feedbackUp}
                            onClick={() => setFeedback(m.id, 'up')}
                          >
                            <IconThumbUp size={18} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={c.feedbackDown}
                            onClick={() => setFeedback(m.id, 'down')}
                          >
                            <IconThumbDown size={18} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ),
            )}

            {thinking && (
              <div className="msg msg--assistant" role="status">
                <p className="msg__bubble msg__bubble--thinking">
                  <span className="typing" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  {c.thinking}
                </p>
              </div>
            )}

            {status === 'error' && (
              <div className="msg msg--assistant" role="alert">
                <div className="msg__bubble msg__bubble--error">
                  <p>{c.error}</p>
                  <div className="chat__error-actions">
                    <button type="button" className="btn btn--secondary" onClick={retry}>
                      <IconRetry size={18} />
                      {c.retry}
                    </button>
                    <a className="btn btn--quiet" href={`tel:${t.contacts.phoneHref}`}>
                      <IconPhone size={18} />
                      {c.fallbackCall}
                    </a>
                  </div>
                </div>
              </div>
            )}

            <div ref={listEndRef} />
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
            <button
              type="submit"
              className="chat__send"
              aria-label={c.send}
              disabled={!draft.trim() || thinking}
            >
              <IconSend size={20} />
            </button>
          </form>

          <p className="chat__fallback">
            {c.fallbackTitle}{' '}
            <a href={`tel:${t.contacts.phoneHref}`}>{t.contacts.phone}</a>
          </p>
        </div>
      )}
    </>
  )
}
