import { NO_ANSWER } from '../../shared/protocol.js'
import type {
  AnswerKind,
  AnswerMeta,
  AnswerSource,
  Attempt,
  ChatEvent,
  ChatRequest,
  ChatTurn,
  RefusalReason,
  RetrievalInfo,
} from '../../shared/protocol.js'
import { getDb } from '../db/client.js'
import { env } from '../env.js'
import { ChainError, generateText, streamWithFallback } from '../llm/chain.js'
import { chain, providers } from '../llm/registry.js'
import { condenseRequest, noRagRequest, parseKindTag, ragRequest } from './prompt.js'
import { retrieve } from './retrieve.js'
import { syncBeforeAnswer } from './sync.js'

/* ============================================================
   ОТВЕТ НА ВОПРОС — весь конвейер RAG по шагам:

   1. condense  — follow-up вопрос → самостоятельный (если есть история);
   2. retrieve  — гибридный поиск кусков;
   3. threshold — в промпт идут куски, только если лучший не слабее
                  порога. Не прошёл — модель отвечает без фрагментов:
                  поздороваться, вернуть к теме, дать общую справку
                  или честно сказать, что точных данных нет. Клиенту
                  сразу уходит событие retrieval с таблицей найденного;
   4. generate  — модель отвечает, токены идут потоком. Первой строкой
                  она ставит метку вида ответа [[kb]] и т. п. — сервер
                  её вырезает;
   5. cite      — из ответа достаются сноски [n] → источники;
   6. trace     — всё это пишется в chat_traces для админки.

   Без настоящей модели (офлайн-цепочка local) при непройденном
   пороге остаётся прежний честный отказ без вызова модели.
   ============================================================ */

export type Emit = (ev: ChatEvent) => Promise<void>

/** Цепочка без офлайн-заглушки local: служебным шагам нужна настоящая модель. */
export const realChain = chain.filter((e) => e.provider !== 'local' && providers.has(e.provider))

/**
 * Шаг condense: follow-up → самостоятельный вопрос.
 * null — переписывать нечего (нет истории), некем (нет настоящей
 * модели) или модель вернула тот же вопрос.
 */
export async function condenseQuestion(question: string, history: ChatTurn[], signal?: AbortSignal): Promise<string | null> {
  if (!history.some((t) => t.role === 'user') || !realChain.length) return null
  try {
    const res = await generateText({ ...condenseRequest(question, history), signal }, realChain)
    const text = res.text.trim().replace(/^["«]|["»]$/g, '')
    return text && text.toLowerCase() !== question.trim().toLowerCase() ? text : null
  } catch {
    // Не смогли переформулировать — ищем по исходному вопросу.
    return null
  }
}

/** Почему в промпт не попало ничего подходящего — для трассы и «Пробелов базы». */
function refusalReason(retrieval: RetrievalInfo): RefusalReason {
  if (retrieval.chunks.some((c) => c.n !== null)) return 'model-declined'
  return retrieval.chunks.length ? 'below-threshold' : 'no-chunks'
}

interface Context {
  ipHash: string | null
  signal: AbortSignal
}

export async function answerQuestion(req: ChatRequest, emit: Emit, ctx: Context): Promise<void> {
  const started = Date.now()
  const mode = req.mode ?? 'rag'
  let retrieval: RetrievalInfo | null = null
  let retrieveMs = 0

  const finish = async (
    partial: Pick<AnswerMeta, 'found' | 'kind' | 'refusal' | 'sources' | 'provider' | 'model' | 'attempts' | 'usage'>,
    answer: string,
    generateMs: number,
  ) => {
    const meta: AnswerMeta = {
      ...partial,
      traceId: null,
      mode,
      timings: { retrieveMs, generateMs, totalMs: Date.now() - started },
    }
    meta.traceId = await saveTrace(req, retrieval, answer, meta, ctx.ipHash)
    await emit({ type: 'done', meta })
  }

  /* ---------- Режим без базы знаний: для сравнения ---------- */
  if (mode === 'no-rag') {
    const g0 = Date.now()
    try {
      const res = await streamWithFallback({ ...noRagRequest(req.question, req.locale), signal: ctx.signal }, (t) =>
        void emit({ type: 'token', text: t }),
      )
      await finish(
        {
          found: true,
          kind: null,
          refusal: null,
          sources: [],
          provider: res.provider,
          model: res.model,
          attempts: res.attempts,
          usage: res.usage,
        },
        res.text,
        Date.now() - g0,
      )
    } catch (err) {
      await fail(err, emit, ctx, req)
    }
    return
  }

  /* ---------- 0. свериться с Google Drive (параллельно с condense) ---------- */
  const synced = syncBeforeAnswer()

  /* ---------- 1. condense ---------- */
  const condensed = await condenseQuestion(req.question, req.history, ctx.signal)
  await synced
  // В поиск идёт самостоятельный вопрос; модель же видит исходный
  // вопрос вместе с последними репликами диалога.
  const searchQuery = condensed ?? req.question

  /* ---------- 2. retrieve + 3. threshold ---------- */
  try {
    const r = await retrieve(searchQuery, req.locale)
    retrieveMs = r.ms
    const passed = r.bestScore !== null && r.bestScore >= env.RAG_MIN_SCORE
    retrieval = {
      question: req.question,
      condensed,
      // Порог не пройден — ни один кусок не идёт в промпт, и таблица это показывает.
      chunks: passed ? r.chunks : r.chunks.map((c) => ({ ...c, n: null })),
      bestScore: r.bestScore,
      threshold: env.RAG_MIN_SCORE,
      method: 'hybrid',
      ms: r.ms,
    }
  } catch (err) {
    console.error('[retrieve]', err)
    await emit({ type: 'error', code: 'unavailable', message: 'Поиск по базе знаний недоступен' })
    return
  }
  await emit({ type: 'retrieval', retrieval })

  const refuse = (reason: RefusalReason, attempts: Attempt[] = [], extra: Partial<AnswerMeta> = {}, generateMs = 0) =>
    finish(
      {
        found: false,
        kind: null,
        refusal: { reason, bestScore: retrieval!.bestScore, threshold: env.RAG_MIN_SCORE },
        sources: [],
        provider: extra.provider ?? null,
        model: extra.model ?? null,
        attempts,
        usage: extra.usage ?? null,
      },
      '',
      generateMs,
    )

  const inPrompt = retrieval.chunks.filter((c) => c.n !== null).length
  // Офлайн-модель умеет только пересказывать фрагменты: без них — честный отказ.
  if (!inPrompt && !realChain.length) return refuse(refusalReason(retrieval))

  /* ---------- 4. generate ---------- */
  const g0 = Date.now()
  // Начало ответа придерживаем, пока не станет ясно, что это: метка
  // [[kind]] (её вырезаем) или маркер NO_ANSWER офлайн-модели.
  let held = ''
  let released = false
  let kindTag: AnswerKind | null = null
  let shown = ''
  const show = (t: string) => {
    // Перевод строки после метки клиенту не нужен.
    const out = shown ? t : t.trimStart()
    if (!out) return
    shown += out
    void emit({ type: 'token', text: out })
  }
  const onText = (t: string) => {
    if (released) return show(t)
    held += t
    const probe = held.trimStart()
    if (NO_ANSWER.startsWith(probe) || probe.startsWith(NO_ANSWER)) return
    const tag = parseKindTag(held)
    if (tag.pending) return
    released = true
    kindTag = tag.kind
    show(tag.rest)
  }

  let res
  try {
    res = await streamWithFallback(
      {
        ...ragRequest({
          question: req.question,
          locale: req.locale,
          history: req.history,
          chunks: retrieval.chunks,
          bestScore: retrieval.bestScore,
          threshold: env.RAG_MIN_SCORE,
        }),
        signal: ctx.signal,
      },
      onText,
    )
  } catch (err) {
    await fail(err, emit, ctx, req, retrieval)
    return
  }
  const generateMs = Date.now() - g0

  const parsed = parseKindTag(res.text)
  const text = parsed.rest.trim()
  if (!text || text.startsWith(NO_ANSWER)) {
    return refuse(refusalReason(retrieval), res.attempts, res, generateMs)
  }
  if (!released) show(text)

  /* ---------- 5. cite ---------- */
  const cited = new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))
  const sources: AnswerSource[] = retrieval.chunks
    .filter((c) => c.n !== null && cited.has(c.n))
    .map((c) => ({ n: c.n!, source: c.source, text: c.text }))

  // Метка модели главнее; без метки (офлайн-модель) судим по сноскам.
  let kind: AnswerKind = kindTag ?? parsed.kind ?? (sources.length ? 'kb' : 'general')
  if (kind === 'general' && sources.length) kind = 'kb'

  await finish(
    {
      found: kind === 'kb',
      kind,
      refusal:
        kind === 'missing'
          ? { reason: refusalReason(retrieval), bestScore: retrieval.bestScore, threshold: env.RAG_MIN_SCORE }
          : null,
      sources,
      provider: res.provider,
      model: res.model,
      attempts: res.attempts,
      usage: res.usage,
    },
    text,
    generateMs,
  )
}

async function fail(err: unknown, emit: Emit, ctx: Context, req?: ChatRequest, retrieval?: RetrievalInfo | null) {
  if (ctx.signal.aborted) return
  console.error('[answer]', err)
  if (err instanceof ChainError && req) {
    // Трасса неудачи тоже нужна: в админке видно, какие модели упали и почему.
    await saveTrace(req, retrieval ?? null, '', {
      traceId: null,
      mode: req.mode ?? 'rag',
      found: false,
      kind: null,
      refusal: null,
      sources: [],
      provider: null,
      model: null,
      attempts: err.attempts,
      timings: { retrieveMs: retrieval?.ms ?? 0, generateMs: 0, totalMs: 0 },
      usage: null,
    }, ctx.ipHash)
  }
  await emit({ type: 'error', code: 'unavailable', message: 'Модели сейчас недоступны' })
}

async function saveTrace(
  req: ChatRequest,
  retrieval: RetrievalInfo | null,
  answer: string,
  meta: AnswerMeta,
  ipHash: string | null,
): Promise<string | null> {
  try {
    const db = await getDb()
    // JSON уходит строкой и приводится через ::text::jsonb: так его
    // одинаково понимают и PGlite, и postgres.js (тот при голом ::jsonb
    // кодирует строку в JSON ещё раз и в базу пишется строка, не объект).
    const [row] = await db.query<{ id: string }>(
      `insert into chat_traces (locale, mode, question, condensed_question, retrieval, answer, found, answer_kind,
                                refusal, provider, model, attempts, timings, usage, ip_hash)
       values ($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9::text::jsonb, $10, $11,
               $12::text::jsonb, $13::text::jsonb, $14::text::jsonb, $15)
       returning id`,
      [
        req.locale,
        meta.mode,
        req.question,
        retrieval?.condensed ?? null,
        retrieval ? JSON.stringify(retrieval) : null,
        answer,
        meta.found,
        meta.kind,
        meta.refusal ? JSON.stringify(meta.refusal) : null,
        meta.provider,
        meta.model,
        JSON.stringify(meta.attempts),
        JSON.stringify(meta.timings),
        meta.usage ? JSON.stringify(meta.usage) : null,
        ipHash,
      ],
    )
    return row.id
  } catch (err) {
    // Трасса — служебная запись: её сбой не должен ломать ответ клиенту.
    console.error('[trace]', err)
    return null
  }
}
