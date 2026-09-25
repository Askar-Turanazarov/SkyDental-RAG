import { useCallback, useEffect, useRef, useState } from 'react'
import type { Locale } from '../../i18n/types'
import { ragClient } from './ragClient'
import type { ChatTurn, RagSource } from './ragClient'

export type Feedback = 'up' | 'down'

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  sources?: RagSource[]
  /** Ответа в материалах нет — показываем путь к живому человеку. */
  notFound?: boolean
  feedback?: Feedback
}

export type ChatStatus = 'idle' | 'thinking' | 'error'

let nextId = 1

export function useChat(locale: Locale) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<ChatStatus>('idle')
  const lastQuestion = useRef<string>('')
  const inflight = useRef<AbortController | null>(null)

  // Незавершённый запрос отменяется при размонтировании.
  useEffect(() => () => inflight.current?.abort(), [])

  const ask = useCallback(
    async (question: string, history: ChatTurn[]) => {
      inflight.current?.abort()
      const ctrl = new AbortController()
      inflight.current = ctrl
      lastQuestion.current = question
      setStatus('thinking')

      try {
        const res = await ragClient.ask(question, locale, history, ctrl.signal)
        setMessages((prev) => [
          ...prev,
          {
            id: nextId++,
            role: 'assistant',
            text: res.text,
            sources: res.sources,
            notFound: !res.found,
          },
        ])
        setStatus('idle')
      } catch (err) {
        // Отмена — это не ошибка: её вызвал новый вопрос или закрытие.
        if (ctrl.signal.aborted) return
        console.error('[chat]', err)
        setStatus('error')
      }
    },
    [locale],
  )

  const send = useCallback(
    (raw: string) => {
      const question = raw.trim()
      if (!question || status === 'thinking') return
      const history: ChatTurn[] = messages.map(({ role, text }) => ({ role, text }))
      setMessages((prev) => [...prev, { id: nextId++, role: 'user', text: question }])
      void ask(question, history)
    },
    [ask, messages, status],
  )

  /** Повтор последнего вопроса после ошибки связи. */
  const retry = useCallback(() => {
    if (!lastQuestion.current) return
    const history: ChatTurn[] = messages.slice(0, -1).map(({ role, text }) => ({ role, text }))
    void ask(lastQuestion.current, history)
  }, [ask, messages])

  const setFeedback = useCallback((id: number, value: Feedback) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, feedback: value } : m)))
    // TODO(RAG): отправлять отзыв на бэкенд вместе с id ответа —
    // это главный сигнал для улучшения выдачи.
  }, [])

  return { messages, status, send, retry, setFeedback, isStub: ragClient.isStub }
}
