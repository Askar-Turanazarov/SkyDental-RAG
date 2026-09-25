import type { Locale } from '../../i18n/types'
import { searchMockKnowledge } from './mockKnowledge'

/* ============================================================
   ШОВ RAG-БОТА. Это единственный файл, который нужно поменять,
   чтобы подключить настоящий бэкенд. Компоненты чата знают только
   интерфейс RagClient и не зависят от того, что за ним стоит.

   Как подключить:
     1. Поднимите эндпоинт, который принимает POST с телом
        { question: string, locale: 'ru' | 'uz', history: ChatTurn[] }
        и отвечает JSON
        { answer: string, sources: { title: string, url?: string }[] }
        Пустой answer или found: false — «в материалах нет ответа».
     2. Пропишите его в .env:  VITE_RAG_ENDPOINT=https://…/chat
     3. Пересоберите проект. Плашка «Демо-режим» исчезнет сама.
   ============================================================ */

export interface RagSource {
  title: string
  url?: string
}

export interface RagAnswer {
  text: string
  sources: RagSource[]
  /** false — в материалах клиники ответа нет. UI покажет честный
   *  отказ и путь к живому человеку, а не выдуманный ответ. */
  found: boolean
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface RagClient {
  /** true — работает мок по локальной базе, а не настоящий RAG. */
  readonly isStub: boolean
  ask(question: string, locale: Locale, history: ChatTurn[], signal?: AbortSignal): Promise<RagAnswer>
}

/* ---------- Мок: поиск по локальной базе ---------- */

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

const mockRagClient: RagClient = {
  isStub: true,
  async ask(question, locale, _history, signal) {
    // Имитация задержки поиска и генерации, чтобы UI загрузки был
    // проверен уже сейчас, а не впервые на проде.
    await sleep(650 + Math.random() * 500, signal)
    const hit = searchMockKnowledge(question, locale)
    if (!hit) return { text: '', sources: [], found: false }
    return { text: hit.answer, sources: [{ title: hit.source }], found: true }
  },
}

/* ---------- HTTP: настоящий бэкенд ---------- */

interface HttpResponseBody {
  answer?: string
  sources?: RagSource[]
  found?: boolean
}

function httpRagClient(endpoint: string): RagClient {
  return {
    isStub: false,
    async ask(question, locale, history, signal) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, locale, history }),
        signal,
      })
      if (!res.ok) throw new Error(`RAG endpoint responded ${res.status}`)
      const body = (await res.json()) as HttpResponseBody
      const text = body.answer?.trim() ?? ''
      return {
        text,
        sources: Array.isArray(body.sources) ? body.sources : [],
        found: body.found ?? text.length > 0,
      }
    },
  }
}

const endpoint = import.meta.env.VITE_RAG_ENDPOINT?.trim()

export const ragClient: RagClient = endpoint ? httpRagClient(endpoint) : mockRagClient
