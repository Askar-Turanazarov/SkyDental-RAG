import { NO_ANSWER } from '../../shared/protocol.js'
import { queryTerms, stems } from '../../shared/text.js'
import { EMBED_DIM } from '../env.js'
import { ProviderError, normalize } from './types.js'
import type { LLMProvider, StreamPart } from './types.js'

/* ============================================================
   Офлайн-провайдер `local`: без ключей и без сети.

   Нужен, чтобы весь пайплайн (индексация → поиск → ответ → трасса)
   запускался на любом ноутбуке и в CI. Настоящим ИИ он не является:
   - эмбеддинги — «мешок основ слов», разложенный хешем по 768
     измерениям. Похожесть получается чисто лексической, и между
     языками она не работает — хорошая иллюстрация того, чем
     настоящая модель эмбеддингов лучше;
   - «генерация» — извлекающая: возвращает кусок контекста, больше
     всех совпавший с вопросом по словам, со сноской [n]; без общих
     слов отвечает NO_ANSWER (путь «модель отказалась»).

   Модели-двойники для проверки fallback:
     local:fail-429   — всегда «перегружена» (retryable)
     local:fail-auth  — «неверный ключ» (auth)
     local:extractive — отвечает лучшим по словам куском контекста
   Пример: LLM_CHAIN=local:fail-429,local:extractive
   ============================================================ */

function hashStem(s: string): number {
  // FNV-1a: быстрый стабильный хеш строки.
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function localEmbedding(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0)
  for (const stem of stems(text)) {
    const h = hashStem(stem)
    v[h % EMBED_DIM] += h & 0x80000000 ? -1 : 1
  }
  return normalize(v)
}

/**
 * «Генерация» офлайн-провайдера. Промпт RAG выглядит так (server/rag/prompt.ts):
 *   [1] (источник)\nтекст\n\n[2] (источник)\nтекст … \n\nВопрос: …
 * Берём кусок, где больше всего общих с вопросом основ слов, и цитируем
 * его со сноской. Общих слов нет ни с одним — честно отвечаем NO_ANSWER,
 * как требует промпт от настоящей модели.
 */
function extractiveAnswer(prompt: string): string {
  const chunks = [...prompt.matchAll(/\[(\d+)\] \([^\n]*\)\n([\s\S]*?)(?=\n\n\[\d+\] \(|\n\n(?:Вопрос|Savol): |$)/g)].map(
    (m) => ({ n: Number(m[1]), text: m[2].trim() }),
  )
  // Контекста нет (режим «без RAG») — пересказывать нечего.
  if (!chunks.length) return 'Офлайн-провайдер умеет только пересказывать найденный контекст, а контекста нет.'

  const question = /\n\n(?:Вопрос|Savol): ([\s\S]*)$/.exec(prompt)?.[1] ?? ''
  const terms = new Set(queryTerms(question).terms)
  let best: (typeof chunks)[number] | null = null
  let bestHits = 0
  for (const chunk of chunks) {
    const hits = new Set(stems(chunk.text).filter((s) => terms.has(s))).size
    if (hits > bestHits) {
      best = chunk
      bestHits = hits
    }
  }
  return best ? `${best.text} [${best.n}]` : NO_ANSWER
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true })
  })

export function localProvider(): LLMProvider {
  return {
    id: 'local',

    async *stream(model, req): AsyncGenerator<StreamPart> {
      if (model === 'fail-429') throw new ProviderError('local 429: имитация перегрузки', 'retryable', 429)
      if (model === 'fail-auth') throw new ProviderError('local 401: имитация неверного ключа', 'auth', 401)

      const prompt = req.messages.at(-1)?.text ?? ''
      const answer = extractiveAnswer(prompt)

      // Стримим по словам, чтобы UI вёл себя как с настоящей моделью.
      for (const word of answer.split(/(?<= )/)) {
        await sleep(12, req.signal)
        yield { text: word }
      }
      yield { usage: { inputTokens: Math.round(prompt.length / 4), outputTokens: Math.round(answer.length / 4) } }
    },

    async embed(_model, texts) {
      return texts.map(localEmbedding)
    },

    async listModels() {
      return ['extractive', 'fail-429', 'fail-auth', 'hash-768']
    },
  }
}
