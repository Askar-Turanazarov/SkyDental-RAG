import { useCallback, useEffect, useRef, useState } from 'react'
import type { Locale } from '../../i18n/types'
import { ragClient } from './ragClient'
import type { AnswerMeta, ChatEvent, ChatTurn, RetrievalInfo } from './ragClient'

export type Feedback = 'up' | 'down'

/** Ответ той же модели без базы знаний — для сравнения «RAG вкл/выкл». */
export interface CompareAnswer {
  text: string
  streaming: boolean
  meta?: AnswerMeta
  failed?: boolean
}

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** Ответ ещё печатается. */
  streaming?: boolean
  /** Что нашёл поиск — приходит раньше первого слова ответа. */
  retrieval?: RetrievalInfo
  meta?: AnswerMeta
  /** Ответа в материалах нет — показываем путь к живому человеку. */
  notFound?: boolean
  feedback?: Feedback
  /** После 👎: open — поле комментария открыто, sent — отправлен. */
  comment?: 'open' | 'sent'
  compare?: CompareAnswer
}

/**
 * idle — ждём вопроса; searching — идёт поиск по базе;
 * generating — поиск закончен, модель пишет; error / rate-limit — сбой.
 */
export type ChatStatus = 'idle' | 'searching' | 'generating' | 'error' | 'rate-limit'

let nextId = 1

export function useChat(locale: Locale) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<ChatStatus>('idle')
  const lastQuestion = useRef<string>('')
  const inflight = useRef<AbortController | null>(null)
  // Актуальная лента для колбэков, которые живут дольше одного рендера.
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  // Незавершённый запрос отменяется при размонтировании.
  useEffect(() => () => inflight.current?.abort(), [])

  const patch = useCallback((id: number, fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)))
  }, [])

  const ask = useCallback(
    async (question: string, history: ChatTurn[]) => {
      inflight.current?.abort()
      const ctrl = new AbortController()
      inflight.current = ctrl
      lastQuestion.current = question
      setStatus('searching')

      const id = nextId++
      setMessages((prev) => [...prev, { id, role: 'assistant', text: '', streaming: true }])

      const onEvent = (ev: ChatEvent) => {
        switch (ev.type) {
          case 'retrieval':
            setStatus('generating')
            patch(id, (m) => ({ ...m, retrieval: ev.retrieval }))
            break
          case 'token':
            patch(id, (m) => ({ ...m, text: m.text + ev.text }))
            break
          case 'done':
            setStatus('idle')
            patch(id, (m) => ({ ...m, streaming: false, meta: ev.meta, notFound: !ev.meta.found }))
            break
          case 'error':
            setStatus(ev.code === 'rate-limit' ? 'rate-limit' : 'error')
            setMessages((prev) => prev.filter((m) => m.id !== id))
            break
        }
      }

      try {
        await ragClient.stream({ question, locale, history, mode: 'rag' }, onEvent, ctrl.signal)
      } catch (err) {
        // Отмена — это не ошибка: её вызвал новый вопрос или закрытие.
        if (ctrl.signal.aborted) return
        console.error('[chat]', err)
        setMessages((prev) => prev.filter((m) => m.id !== id))
        setStatus('error')
      }
    },
    [locale, patch],
  )

  const toHistory = (list: ChatMessage[]): ChatTurn[] =>
    list.filter((m) => !m.streaming && m.text).map(({ role, text }) => ({ role, text }))

  const send = useCallback(
    (raw: string) => {
      const question = raw.trim()
      if (!question || status === 'searching' || status === 'generating') return
      const history = toHistory(messagesRef.current)
      setMessages((prev) => [...prev, { id: nextId++, role: 'user', text: question }])
      void ask(question, history)
    },
    [ask, status],
  )

  /** Повтор последнего вопроса после ошибки связи. */
  const retry = useCallback(() => {
    if (!lastQuestion.current) return
    void ask(lastQuestion.current, toHistory(messagesRef.current.slice(0, -1)))
  }, [ask])

  const setFeedback = useCallback(
    (id: number, value: Feedback) => {
      const msg = messagesRef.current.find((m) => m.id === id)
      patch(id, (m) => ({ ...m, feedback: value, comment: value === 'down' ? 'open' : undefined }))
      // Отзыв привязан к трассе ответа: в админке по нему видно,
      // что нашёл поиск и какая модель отвечала.
      const traceId = msg?.meta?.traceId
      if (traceId) ragClient.feedback(traceId, value).catch((err) => console.error('[feedback]', err))
    },
    [patch],
  )

  const sendComment = useCallback(
    (id: number, comment: string) => {
      const msg = messagesRef.current.find((m) => m.id === id)
      patch(id, (m) => ({ ...m, comment: 'sent' }))
      const traceId = msg?.meta?.traceId
      if (traceId && comment.trim()) {
        ragClient.feedback(traceId, 'down', comment.trim()).catch((err) => console.error('[feedback]', err))
      }
    },
    [patch],
  )

  /** Тот же вопрос той же модели, но без базы знаний. */
  const compareWithoutRag = useCallback(
    async (id: number) => {
      const list = messagesRef.current
      const idx = list.findIndex((m) => m.id === id)
      const question = [...list.slice(0, idx)].reverse().find((m) => m.role === 'user')?.text
      if (!question) return

      patch(id, (m) => ({ ...m, compare: { text: '', streaming: true } }))
      const onEvent = (ev: ChatEvent) => {
        if (ev.type === 'token') {
          patch(id, (m) => ({ ...m, compare: { ...m.compare!, text: m.compare!.text + ev.text } }))
        } else if (ev.type === 'done') {
          patch(id, (m) => ({ ...m, compare: { ...m.compare!, streaming: false, meta: ev.meta } }))
        } else if (ev.type === 'error') {
          patch(id, (m) => ({ ...m, compare: { text: '', streaming: false, failed: true } }))
        }
      }
      try {
        await ragClient.stream({ question, locale, history: [], mode: 'no-rag' }, onEvent)
      } catch {
        patch(id, (m) => ({ ...m, compare: { text: '', streaming: false, failed: true } }))
      }
    },
    [locale, patch],
  )

  return {
    messages,
    status,
    send,
    retry,
    setFeedback,
    sendComment,
    compareWithoutRag,
    isStub: ragClient.isStub,
  }
}
