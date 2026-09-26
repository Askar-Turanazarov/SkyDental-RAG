import { sseData } from '../../../shared/sse.js'
import type { AnswerKind, AnswerMeta, ChatEvent, ChatRequest, RetrievedChunk } from '../../../shared/protocol.js'
import { searchMockKnowledge } from './mockKnowledge'

export type { AnswerMeta, ChatEvent, ChatTurn, RetrievalInfo, RetrievedChunk } from '../../../shared/protocol.js'

/* ============================================================
   ШОВ RAG-БОТА. Компоненты чата знают только интерфейс RagClient.

   За ним два варианта:
   - HTTP — настоящий бэкенд (server/, /api/chat). Включается
     переменной VITE_RAG_ENDPOINT=/api/chat.
   - Демо — поиск по словам прямо в браузере, без сервера. Отдаёт
     те же события протокола (retrieval → token → done), поэтому
     интерфейс и панель «Как я нашёл ответ» работают и в демо.

   Протокол событий описан в shared/protocol.ts.
   ============================================================ */

export interface RagClient {
  /** true — работает демо в браузере, а не настоящий RAG. */
  readonly isStub: boolean
  stream(req: ChatRequest, onEvent: (ev: ChatEvent) => void, signal?: AbortSignal): Promise<void>
  feedback(traceId: string, rating: 'up' | 'down', comment?: string): Promise<void>
}

/* ---------- HTTP: настоящий бэкенд ---------- */

function httpRagClient(endpoint: string): RagClient {
  const feedbackUrl = endpoint.replace(/chat\/?$/, 'feedback')

  return {
    isStub: false,

    async stream(req, onEvent, signal) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(req),
        signal,
      })
      if (!res.ok || !res.body) throw new Error(`RAG endpoint responded ${res.status}`)

      let finished = false
      for await (const data of sseData(res.body)) {
        const ev = JSON.parse(data) as ChatEvent
        if (ev.type === 'done' || ev.type === 'error') finished = true
        onEvent(ev)
      }
      // Поток оборвался без итогового события — это обрыв связи.
      if (!finished) throw new Error('RAG stream ended unexpectedly')
    },

    async feedback(traceId, rating, comment) {
      const res = await fetch(feedbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traceId, rating, comment }),
      })
      if (!res.ok) throw new Error(`feedback responded ${res.status}`)
    },
  }
}

/* ---------- Демо: поиск по словам в браузере ---------- */

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

const DEMO_TOP_K = 3

const mockRagClient: RagClient = {
  isStub: true,

  async stream(req, onEvent, signal) {
    const started = performance.now()
    // Имитация задержек поиска и генерации: UI загрузки проверен
    // уже сейчас, а не впервые на проде.
    await sleep(350 + Math.random() * 250, signal)

    if (req.mode === 'no-rag') {
      const text =
        req.locale === 'ru'
          ? 'В демо-режиме модели нет — сравнение «без RAG» работает только с настоящим бэкендом.'
          : 'Demo rejimda model yoʻq — «RAGsiz» taqqoslash faqat haqiqiy backend bilan ishlaydi.'
      onEvent({ type: 'token', text })
      onEvent({ type: 'done', meta: demoMeta(req, null, [], started, 0) })
      return
    }

    const { hits } = searchMockKnowledge(req.question, req.locale)
    const chunks: RetrievedChunk[] = hits.map((h, i) => ({
      chunkId: `${h.doc.locale}:${h.doc.sourceLabel}:${h.doc.ord}`,
      locale: h.doc.locale,
      source: h.doc.sourceLabel,
      text: h.doc.text,
      vecScore: null,
      vecRank: null,
      textScore: Number(h.score.toFixed(2)),
      textRank: h.rank,
      rrf: Number(h.score.toFixed(2)),
      n: i < DEMO_TOP_K ? i + 1 : null,
    }))
    const retrieveMs = Math.round(performance.now() - started)
    onEvent({
      type: 'retrieval',
      retrieval: {
        question: req.question,
        condensed: null,
        chunks,
        bestScore: chunks[0]?.textScore ?? null,
        threshold: 0,
        method: 'keyword',
        ms: retrieveMs,
      },
    })

    if (!chunks.length) {
      onEvent({ type: 'done', meta: demoMeta(req, null, [], started, retrieveMs) })
      return
    }

    // «Генерация» демо — первый найденный кусок со сноской.
    await sleep(250, signal)
    const answer = `${chunks[0].text} [1]`
    for (const word of answer.split(/(?<= )/)) {
      await sleep(18, signal)
      onEvent({ type: 'token', text: word })
    }
    const sources = [{ n: 1, source: chunks[0].source, text: chunks[0].text }]
    onEvent({ type: 'done', meta: demoMeta(req, 'kb', sources, started, retrieveMs) })
  },

  async feedback() {
    // В демо отзыв некуда отправить: бэкенда нет.
  },
}

function demoMeta(
  req: ChatRequest,
  kind: AnswerKind | null,
  sources: { n: number; source: string; text: string }[],
  started: number,
  retrieveMs: number,
): AnswerMeta {
  const totalMs = Math.round(performance.now() - started)
  const mode = req.mode ?? 'rag'
  return {
    traceId: null,
    mode,
    found: kind === 'kb',
    kind,
    // Как офлайн-модель на сервере: без фрагментов — честный отказ.
    refusal: kind === null && mode === 'rag' ? { reason: 'no-chunks', bestScore: null, threshold: 0 } : null,
    sources,
    provider: 'demo',
    model: 'keyword-search',
    attempts: [],
    timings: { retrieveMs, generateMs: totalMs - retrieveMs, totalMs },
    usage: null,
  }
}

const endpoint = import.meta.env.VITE_RAG_ENDPOINT?.trim()

export const ragClient: RagClient = endpoint ? httpRagClient(endpoint) : mockRagClient
