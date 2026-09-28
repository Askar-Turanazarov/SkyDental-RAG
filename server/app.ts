import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import type { ChatEvent } from '../shared/protocol.js'
import { getDb } from './db/client.js'
import { env } from './env.js'
import { chainStatus } from './llm/chain.js'
import { chain, embedModelLabel, providers } from './llm/registry.js'
import admin from './admin/routes.js'
import booking from './booking/routes.js'
import { answerQuestion } from './rag/answer.js'
import { clientIp, hashIp, overLimit } from './rateLimit.js'

/* ============================================================
   HTTP API. Одно и то же приложение Hono работает:
   - на Vercel — через api/index.ts (serverless-функция);
   - локально — через server/dev.ts (Node-сервер на :8787).
   ============================================================ */

const app = new Hono().basePath('/api')

const chatSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  locale: z.enum(['ru', 'uz']),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .max(20)
    .default([]),
  mode: z.enum(['rag', 'no-rag']).default('rag'),
})

app.post('/chat', async (c) => {
  const parsed = chatSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'bad-request' }, 400)

  const ipHash = hashIp(clientIp(c.req.raw.headers))
  let limited = false
  try {
    limited = await overLimit(`chat:${ipHash}`)
  } catch (err) {
    // Счётчик недоступен — лучше ответить, чем отказать всем.
    console.error('[rate-limit]', err)
  }

  return streamSSE(c, async (stream) => {
    const ctrl = new AbortController()
    stream.onAbort(() => ctrl.abort())

    // События пишем строго по очереди: токены приходят чаще,
    // чем уходят в сеть, и порядок терять нельзя.
    let queue = Promise.resolve()
    const emit = (ev: ChatEvent) => {
      queue = queue.then(() => stream.writeSSE({ data: JSON.stringify(ev) })).catch(() => {})
      return queue
    }

    if (limited) {
      await emit({ type: 'error', code: 'rate-limit', message: 'Слишком много вопросов, попробуйте через несколько минут' })
      return
    }
    await answerQuestion(parsed.data, emit, { ipHash, signal: ctrl.signal })
    await queue
  })
})

const feedbackSchema = z.object({
  traceId: z.string().uuid(),
  rating: z.enum(['up', 'down']),
  comment: z.string().trim().max(1000).optional(),
})

app.post('/feedback', async (c) => {
  const parsed = feedbackSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'bad-request' }, 400)
  const { traceId, rating, comment } = parsed.data
  const db = await getDb()
  await db.query(
    `insert into feedback (trace_id, rating, comment) values ($1, $2, $3)
     on conflict (trace_id) do update set rating = excluded.rating,
       comment = coalesce(excluded.comment, feedback.comment), created_at = now()`,
    [traceId, rating, comment || null],
  )
  return c.json({ ok: true })
})

/** Состояние сервиса: база, индекс, провайдеры, цепочка моделей. */
app.get('/health', async (c) => {
  const db = await getDb()
  const [stats] = await db.query<{ chunks: number; stale: number; documents: number }>(
    `select (select count(*)::int from chunks) as chunks,
            (select count(*)::int from chunks where embed_model is distinct from $1) as stale,
            (select count(*)::int from documents) as documents`,
    [embedModelLabel],
  )
  return c.json({
    ok: true,
    db: db.driver,
    index: { ...stats, embedModel: embedModelLabel, needsReindex: stats.stale > 0 || (stats.documents > 0 && stats.chunks === 0) },
    providers: [...providers.keys()],
    chain: await chainStatus(),
    rag: { topK: env.RAG_TOP_K, minScore: env.RAG_MIN_SCORE },
    configuredChain: chain.map((e) => `${e.provider}:${e.model}`),
  })
})

/** Запись на приём: /api/booking/* (server/booking/routes.ts). */
app.route('/booking', booking)

/** Админка: /api/admin/* (server/admin/routes.ts). */
app.route('/admin', admin)

app.onError((err, c) => {
  console.error('[api]', err)
  return c.json({ error: 'internal' }, 500)
})

export default app
