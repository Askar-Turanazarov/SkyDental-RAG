/* ============================================================
   Единый интерфейс LLM-провайдера.

   Любой провайдер (Gemini, OpenAI-совместимые, Anthropic, офлайн)
   умеет одно и то же: стримить ответ, по возможности — считать
   эмбеддинги и отдавать список моделей. Остальной код знает только
   этот интерфейс, поэтому смена провайдера — это строка в .env.
   ============================================================ */

export interface LLMMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface GenerateRequest {
  system: string
  messages: LLMMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface Usage {
  inputTokens?: number
  outputTokens?: number
}

/** Кусок стрима: текст и/или итоговая статистика токенов. */
export interface StreamPart {
  text?: string
  usage?: Usage
}

export type EmbedKind = 'document' | 'query'

export interface LLMProvider {
  /** Имя в LLM_CHAIN и EMBED_PROVIDER: gemini, openai, openrouter… */
  readonly id: string
  stream(model: string, req: GenerateRequest): AsyncIterable<StreamPart>
  /** Векторы длиной EMBED_DIM, нормированные к единичной длине. */
  embed?(model: string, texts: string[], kind: EmbedKind, signal?: AbortSignal): Promise<number[][]>
  /** Модели, доступные с этим ключом. Нужен, чтобы выкинуть из цепочки несуществующие. */
  listModels?(signal?: AbortSignal): Promise<string[]>
}

/**
 * Ошибка провайдера с классом, от которого зависит fallback:
 * - retryable — перегрузка, лимит, 5xx, таймаут: пробуем следующую модель;
 * - auth — неверный/пустой ключ: весь провайдер выключается надолго;
 * - model — модели нет (404): выключаем эту модель надолго;
 * - fatal — ошибка в самом запросе (400): другая модель не поможет.
 */
export type ProviderErrorKind = 'retryable' | 'auth' | 'model' | 'fatal'

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** HTTP-ответ с ошибкой → ProviderError нужного класса. */
export async function errorFromResponse(res: Response, provider: string): Promise<ProviderError> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 400)
  } catch {
    /* тело не прочиталось — хватит статуса */
  }
  const status = res.status
  const retryAfter = Number(res.headers.get('retry-after'))
  const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined
  const message = `${provider} ${status}${detail ? `: ${compact(detail)}` : ''}`

  if (status === 401 || status === 403) return new ProviderError(message, 'auth', status)
  if (status === 404) return new ProviderError(message, 'model', status)
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) {
    return new ProviderError(message, 'retryable', status, retryAfterMs)
  }
  return new ProviderError(message, 'fatal', status)
}

/** Сетевые сбои и таймауты — тоже повод перейти к следующей модели. */
export function asProviderError(err: unknown, provider: string): ProviderError {
  if (err instanceof ProviderError) return err
  const msg = err instanceof Error ? err.message : String(err)
  return new ProviderError(`${provider}: ${msg}`, 'retryable')
}

function compact(s: string): string {
  try {
    const j = JSON.parse(s) as { error?: { message?: string } | string; message?: string }
    const m = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message)
    if (m) return m.slice(0, 200)
  } catch {
    /* не JSON */
  }
  return s.replace(/\s+/g, ' ').slice(0, 200)
}

/** Нормировка вектора: для косинусной близости важна только длина 1. */
export function normalize(v: number[]): number[] {
  let sum = 0
  for (const x of v) sum += x * x
  const len = Math.sqrt(sum) || 1
  return v.map((x) => x / len)
}
