import { NO_ANSWER } from '../../shared/protocol.js'
import type {
  AnswerMeta,
  AnswerSource,
  Attempt,
  ChatEvent,
  ChatRequest,
  RefusalReason,
  RetrievalInfo,
} from '../../shared/protocol.js'
import { getDb } from '../db/client.js'
import { env } from '../env.js'
import { ChainError, generateText, streamWithFallback } from '../llm/chain.js'
import { chain, providers } from '../llm/registry.js'
import { condenseRequest, noRagRequest, ragRequest } from './prompt.js'
import { retrieve } from './retrieve.js'

/* ============================================================
   ОТВЕТ НА ВОПРОС — весь конвейер RAG по шагам:

   1. condense  — follow-up вопрос → самостоятельный (если есть история);
   2. retrieve  — гибридный поиск кусков; клиенту сразу уходит
                  событие retrieval с таблицей найденного;
   3. threshold — лучший кусок слабее порога → честный отказ,
                  модель даже не вызывается;
   4. generate  — модель отвечает по кускам, токены идут потоком;
   5. cite      — из ответа достаются сноски [n] → источники;
   6. trace     — всё это пишется в chat_traces для админки.
   ============================================================ */

export type Emit = (ev: ChatEvent) => Promise<void>

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
    partial: Pick<AnswerMeta, 'found' | 'refusal' | 'sources' | 'provider' | 'model' | 'attempts' | 'usage'>,
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
        { found: true, refusal: null, sources: [], provider: res.provider, model: res.model, attempts: res.attempts, usage: res.usage },
        res.text,
        Date.now() - g0,
      )
    } catch (err) {
      await fail(err, emit, ctx, req)
    }
    return
  }

  /* ---------- 1. condense ---------- */
  let searchQuery = req.question
  let condensed: string | null = null
  const realChain = chain.filter((e) => e.provider !== 'local' && providers.has(e.provider))
  if (req.history.some((t) => t.role === 'user') && realChain.length) {
    try {
      const res = await generateText({ ...condenseRequest(req.question, req.history), signal: ctx.signal }, realChain)
      const text = res.text.trim().replace(/^["«]|["»]$/g, '')
      if (text && text.toLowerCase() !== req.question.trim().toLowerCase()) {
        condensed = text
        searchQuery = text
      }
    } catch {
      // Не смогли переформулировать — ищем по исходному вопросу.
    }
  }

  /* ---------- 2. retrieve ---------- */
  try {
    const r = await retrieve(searchQuery, req.locale)
    retrieveMs = r.ms
    retrieval = {
      question: req.question,
      condensed,
      chunks: r.chunks,
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

  /* ---------- 3. threshold ---------- */
  const refuse = (reason: RefusalReason, attempts: Attempt[] = [], extra: Partial<AnswerMeta> = {}, generateMs = 0) =>
    finish(
      {
        found: false,
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

  if (!retrieval.chunks.length) return refuse('no-chunks')
  if (retrieval.bestScore === null || retrieval.bestScore < env.RAG_MIN_SCORE) return refuse('below-threshold')

  /* ---------- 4. generate ---------- */
  const g0 = Date.now()
  // Модель может ответить маркером NO_ANSWER. Чтобы он не мелькнул
  // у клиента, начало ответа придерживаем, пока не станет ясно,
  // что это не маркер.
  let held = ''
  let released = false
  const onText = (t: string) => {
    if (released) return void emit({ type: 'token', text: t })
    held += t
    const probe = held.trimStart()
    if (NO_ANSWER.startsWith(probe) || probe.startsWith(NO_ANSWER)) return
    released = true
    void emit({ type: 'token', text: held })
  }

  let res
  try {
    res = await streamWithFallback({ ...ragRequest(req.question, req.locale, retrieval.chunks), signal: ctx.signal }, onText)
  } catch (err) {
    await fail(err, emit, ctx, req, retrieval)
    return
  }
  const generateMs = Date.now() - g0
  const text = res.text.trim()

  if (!text || text.startsWith(NO_ANSWER)) {
    return refuse('model-declined', res.attempts, res, generateMs)
  }
  if (!released) await emit({ type: 'token', text: held })

  /* ---------- 5. cite ---------- */
  const cited = new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))
  const sources: AnswerSource[] = retrieval.chunks
    .filter((c) => c.n !== null && cited.has(c.n))
    .map((c) => ({ n: c.n!, source: c.source, text: c.text }))

  await finish(
    { found: true, refusal: null, sources, provider: res.provider, model: res.model, attempts: res.attempts, usage: res.usage },
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
    const [row] = await db.query<{ id: string }>(
      `insert into chat_traces (locale, mode, question, condensed_question, retrieval, answer, found, refusal,
                                provider, model, attempts, timings, usage, ip_hash)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14)
       returning id`,
      [
        req.locale,
        meta.mode,
        req.question,
        retrieval?.condensed ?? null,
        retrieval ? JSON.stringify(retrieval) : null,
        answer,
        meta.found,
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
