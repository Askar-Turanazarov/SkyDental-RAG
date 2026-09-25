import type { Attempt } from '../../shared/protocol.js'
import { chain as defaultChain, providers } from './registry.js'
import type { ChainEntry } from './registry.js'
import { ProviderError, asProviderError } from './types.js'
import type { GenerateRequest, Usage } from './types.js'

/* ============================================================
   ЦЕПОЧКА МОДЕЛЕЙ С АВТОПЕРЕКЛЮЧЕНИЕМ (fallback) и паузами
   (circuit breaker).

   Модели пробуются по порядку LLM_CHAIN. Если модель ответила
   429/5xx, не уложилась в таймаут или её нет у провайдера, запрос
   тут же уходит следующей, а упавшая «отдыхает» — следующие
   запросы её пропускают и не теряют на ней время.

   Паузы живут в памяти инстанса. На Vercel инстанс переиспользуется
   между запросами (fluid compute), а если он новый — худшее, что
   случится: одна лишняя попытка к занятой модели.

   Переключиться можно только до первого токена: если модель начала
   отвечать и оборвалась, склеивать ответ из двух моделей нельзя.
   ============================================================ */

const FIRST_TOKEN_TIMEOUT_MS = 15_000
const TOTAL_TIMEOUT_MS = 60_000
const COOLDOWN_RETRYABLE_MS = 60_000
const COOLDOWN_AUTH_MS = 10 * 60_000
const COOLDOWN_MODEL_MS = 60 * 60_000
const MODEL_LIST_TTL_MS = 60 * 60_000

/** ключ → момент, до которого модель/провайдер на паузе. */
const cooldowns = new Map<string, { until: number; reason: string }>()
const modelKey = (e: ChainEntry) => `${e.provider}:${e.model}`

function pause(key: string, ms: number, reason: string) {
  cooldowns.set(key, { until: Date.now() + ms, reason })
}

function pausedFor(key: string): { seconds: number; reason: string } | null {
  const c = cooldowns.get(key)
  if (!c) return null
  const left = c.until - Date.now()
  if (left <= 0) {
    cooldowns.delete(key)
    return null
  }
  return { seconds: Math.ceil(left / 1000), reason: c.reason }
}

/* ---------- Какие модели реально доступны с нашим ключом ---------- */

const modelLists = new Map<string, { at: number; models: Promise<Set<string> | null> }>()

/** Список моделей провайдера (кэш на час). null — список получить не удалось, проверку пропускаем. */
function availableModels(providerId: string): Promise<Set<string> | null> {
  const cached = modelLists.get(providerId)
  if (cached && Date.now() - cached.at < MODEL_LIST_TTL_MS) return cached.models
  const p = providers.get(providerId)
  const models: Promise<Set<string> | null> = p?.listModels
    ? p
        .listModels(AbortSignal.timeout(5_000))
        .then((list) => new Set(list))
        .catch(() => null)
    : Promise.resolve(null)
  modelLists.set(providerId, { at: Date.now(), models })
  return models
}

/* ---------- Сам запуск ---------- */

export interface ChainResult {
  text: string
  provider: string
  model: string
  attempts: Attempt[]
  usage: Usage | null
}

export class ChainError extends Error {
  constructor(
    message: string,
    readonly attempts: Attempt[],
  ) {
    super(message)
    this.name = 'ChainError'
  }
}

export interface ChainOptions {
  /** Ручная проверка из админки: звать модель, даже если она на паузе или не в списке. */
  force?: boolean
}

/**
 * Стримит ответ первой доступной модели цепочки.
 * onText вызывается на каждый кусок текста.
 */
export async function streamWithFallback(
  req: GenerateRequest,
  onText: (text: string) => void,
  entries: ChainEntry[] = defaultChain,
  opts: ChainOptions = {},
): Promise<ChainResult> {
  const attempts: Attempt[] = []

  for (const entry of entries) {
    const started = Date.now()
    const skip = (detail: string) => attempts.push({ ...entry, status: 'skipped', detail, ms: 0 })

    const provider = providers.get(entry.provider)
    if (!provider) {
      skip('провайдер не подключён: нет ключа в окружении')
      continue
    }
    if (!opts.force) {
      const paused = pausedFor(`p:${entry.provider}`) ?? pausedFor(`m:${modelKey(entry)}`)
      if (paused) {
        skip(`на паузе ещё ${paused.seconds} с (${paused.reason})`)
        continue
      }
      const listed = await availableModels(entry.provider)
      if (listed && !listed.has(entry.model)) {
        skip('модели нет в списке доступных у провайдера')
        continue
      }
    }

    const ctrl = new AbortController()
    const onOuterAbort = () => ctrl.abort(req.signal?.reason)
    req.signal?.addEventListener('abort', onOuterAbort, { once: true })
    let timedOut: string | null = null
    const firstTokenTimer = setTimeout(() => {
      timedOut = `нет первого токена за ${FIRST_TOKEN_TIMEOUT_MS / 1000} с`
      ctrl.abort()
    }, FIRST_TOKEN_TIMEOUT_MS)
    const totalTimer = setTimeout(() => {
      timedOut = `ответ дольше ${TOTAL_TIMEOUT_MS / 1000} с`
      ctrl.abort()
    }, TOTAL_TIMEOUT_MS)

    let text = ''
    let usage: Usage | null = null
    try {
      for await (const part of provider.stream(entry.model, { ...req, signal: ctrl.signal })) {
        if (part.text) {
          if (!text) clearTimeout(firstTokenTimer)
          text += part.text
          onText(part.text)
        }
        if (part.usage) usage = part.usage
      }
      attempts.push({ ...entry, status: 'ok', ms: Date.now() - started })
      // Модель ответила (например, на пинг) — держать её на паузе незачем.
      cooldowns.delete(`m:${modelKey(entry)}`)
      cooldowns.delete(`p:${entry.provider}`)
      return { text, provider: entry.provider, model: entry.model, attempts, usage }
    } catch (err) {
      // Отмена снаружи (пользователь закрыл чат) — не ошибка модели.
      if (req.signal?.aborted) throw err
      const perr = timedOut ? new ProviderError(timedOut, 'retryable') : asProviderError(err, entry.provider)
      attempts.push({ ...entry, status: 'error', detail: perr.message, ms: Date.now() - started })

      // Ручной пинг — диагностика: показывает ошибку, но маршрутизацию чата не трогает.
      if (!opts.force) {
        if (perr.kind === 'auth') pause(`p:${entry.provider}`, COOLDOWN_AUTH_MS, 'ключ отклонён')
        else if (perr.kind === 'model') pause(`m:${modelKey(entry)}`, COOLDOWN_MODEL_MS, 'модель не найдена')
        else if (perr.kind === 'retryable') {
          pause(`m:${modelKey(entry)}`, perr.retryAfterMs ?? COOLDOWN_RETRYABLE_MS, perr.status ? `HTTP ${perr.status}` : 'сбой/таймаут')
        }
      }

      // Модель уже начала отвечать — подменять её посреди ответа нельзя.
      if (text) throw new ChainError(`${modelKey(entry)} оборвалась посреди ответа`, attempts)
      // Ошибка в самом запросе: другая модель её не исправит.
      if (perr.kind === 'fatal') throw new ChainError(perr.message, attempts)
    } finally {
      clearTimeout(firstTokenTimer)
      clearTimeout(totalTimer)
      req.signal?.removeEventListener('abort', onOuterAbort)
    }
  }

  throw new ChainError('ни одна модель цепочки не ответила', attempts)
}

/** Ответ целиком, без стрима (для служебных вызовов вроде переформулировки вопроса). */
export async function generateText(req: GenerateRequest, entries?: ChainEntry[], opts?: ChainOptions): Promise<ChainResult> {
  return streamWithFallback(req, () => {}, entries, opts)
}

/** Состояние цепочки для админки: что на паузе и почему. */
export async function chainStatus() {
  return Promise.all(
    defaultChain.map(async (entry) => {
      const connected = providers.has(entry.provider)
      const listed = connected ? await availableModels(entry.provider) : null
      return {
        ...entry,
        connected,
        listed: listed ? listed.has(entry.model) : null,
        paused: pausedFor(`p:${entry.provider}`) ?? pausedFor(`m:${modelKey(entry)}`),
      }
    }),
  )
}

/** Снять все паузы (кнопка в админке). */
export function resetCooldowns() {
  cooldowns.clear()
  modelLists.clear()
}
