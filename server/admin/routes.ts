import { Hono } from 'hono'
import { z } from 'zod'
import type {
  AppointmentList,
  AppointmentScope,
  CancelResult,
  DocumentDetail,
  DocumentRow,
  GapGroup,
  ModelsInfo,
  PingResult,
  ReindexResult,
  SandboxResult,
  SaveResult,
  SessionInfo,
  SheetPushResponse,
  Stats,
  SyncRunResult,
  SyncStatus,
  TraceDetail,
  TraceFilter,
  TraceList,
  TraceRow,
} from '../../shared/admin.js'
import { ANSWER_KINDS } from '../../shared/protocol.js'
import type { AnswerKind, AnswerMeta, Locale, RefusalReason, RetrievalInfo } from '../../shared/protocol.js'
import { queryTerms } from '../../shared/text.js'
import { cancelAppointment, listAppointments, sheetStatus } from '../booking/manage.js'
import { pushToSheet } from '../booking/sheet.js'
import { getDb } from '../db/client.js'
import { env } from '../env.js'
import { ChainError, chainStatus, generateText, resetCooldowns } from '../llm/chain.js'
import { embedModelLabel, providers } from '../llm/registry.js'
import { driveEnabled } from '../drive/client.js'
import { reindexAll, saveDocument } from '../rag/ingest.js'
import { ragRequest } from '../rag/prompt.js'
import { SHOW_LIMIT, retrieve } from '../rag/retrieve.js'
import { syncFromDrive, syncStatus } from '../rag/sync.js'
import { clientIp, hashIp, overLimit } from '../rateLimit.js'
import { adminEnabled, checkPassword, endSession, isAuthenticated, requireAdmin, startSession } from './auth.js'
import { zip } from './zip.js'

/* ============================================================
   API админки: /api/admin/*. Всё, кроме входа, — под паролем.
   ============================================================ */

const admin = new Hono()

const PUBLIC = new Set(['/login', '/logout', '/session'])
admin.use('*', async (c, next) => {
  const sub = c.req.path.replace(/^.*?\/admin/, '')
  if (PUBLIC.has(sub)) return next()
  return requireAdmin(c, next)
})

const body = async <T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T> | null> => {
  const parsed = schema.safeParse(await req.json().catch(() => null))
  return parsed.success ? parsed.data : null
}

/* ---------- Вход ---------- */

admin.get('/session', (c) => c.json<SessionInfo>({ enabled: adminEnabled(), authenticated: isAuthenticated(c) }))

admin.post('/login', async (c) => {
  if (!adminEnabled()) return c.json({ error: 'admin-disabled' }, 503)
  // Перебор пароля: не больше 10 попыток за 10 минут с одного адреса.
  if (await overLimit(`login:${hashIp(clientIp(c.req.raw.headers))}`, 10, 600)) {
    return c.json({ error: 'rate-limit' }, 429)
  }
  const data = await body(c.req.raw, z.object({ password: z.string().max(200) }))
  if (!data || !checkPassword(data.password)) return c.json({ error: 'wrong-password' }, 401)
  startSession(c)
  return c.json({ ok: true })
})

admin.post('/logout', (c) => {
  endSession(c)
  return c.json({ ok: true })
})

/* ---------- Трассы и отзывы ---------- */

const TRACE_COLUMNS = `
  t.id, t.created_at as "createdAt", t.locale, t.mode, t.question, t.found, t.answer_kind as kind,
  t.refusal->>'reason' as "refusalReason", t.provider, t.model,
  exists (select 1 from jsonb_array_elements(t.attempts) a where a->>'status' <> 'ok') as fallback,
  coalesce((t.timings->>'totalMs')::int, 0) as "totalMs",
  f.rating, f.comment`

const FILTERS: Record<TraceFilter, string> = {
  all: 'true',
  feedback: 'f.rating is not null',
  down: `f.rating = 'down'`,
  up: `f.rating = 'up'`,
  commented: 'f.comment is not null',
  // Нет ответа в базе: модель сказала «нет данных» или офлайн-отказ.
  notfound: `t.refusal is not null and t.mode = 'rag'`,
}

admin.get('/traces', async (c) => {
  const q = c.req.query()
  const filter = (q.filter in FILTERS ? q.filter : 'all') as TraceFilter
  const mode = q.mode === 'rag' || q.mode === 'no-rag' ? q.mode : null
  const search = (q.q ?? '').trim()
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
  const offset = Math.max(Number(q.offset) || 0, 0)

  const where = [FILTERS[filter], '($1::text is null or t.mode = $1)', `($2 = '' or t.question ilike '%' || $2 || '%')`].join(
    ' and ',
  )
  const db = await getDb()
  const [rows, [count]] = await Promise.all([
    db.query<TraceRow>(
      `select ${TRACE_COLUMNS}, left(t.answer, 280) as answer
       from chat_traces t left join feedback f on f.trace_id = t.id
       where ${where}
       order by t.created_at desc limit ${limit} offset ${offset}`,
      [mode, search],
    ),
    db.query<{ total: number }>(
      `select count(*)::int as total from chat_traces t left join feedback f on f.trace_id = t.id where ${where}`,
      [mode, search],
    ),
  ])
  return c.json<TraceList>({ total: count.total, rows })
})

admin.get('/traces/:id', async (c) => {
  const id = c.req.param('id')
  if (!z.string().uuid().safeParse(id).success) return c.json({ error: 'not-found' }, 404)
  const db = await getDb()
  const [row] = await db.query<
    TraceRow & {
      condensed: string | null
      retrieval: RetrievalInfo | null
      refusal: AnswerMeta['refusal']
      attempts: AnswerMeta['attempts']
      timings: AnswerMeta['timings']
      usage: AnswerMeta['usage']
    }
  >(
    `select ${TRACE_COLUMNS}, t.answer, t.condensed_question as condensed, t.retrieval, t.refusal,
            t.attempts, t.timings, t.usage
     from chat_traces t left join feedback f on f.trace_id = t.id
     where t.id = $1`,
    [id],
  )
  if (!row) return c.json({ error: 'not-found' }, 404)

  const { refusal, attempts, timings, usage, ...rest } = row
  const cited = new Set([...row.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))
  const meta: AnswerMeta = {
    traceId: row.id,
    mode: row.mode,
    found: row.found,
    kind: row.kind,
    refusal,
    sources: (row.retrieval?.chunks ?? [])
      .filter((ch) => ch.n !== null && cited.has(ch.n))
      .map((ch) => ({ n: ch.n!, source: ch.source, text: ch.text })),
    provider: row.provider,
    model: row.model,
    attempts,
    // У старых или оборванных трасс тайминги могут быть неполными.
    timings: { retrieveMs: 0, generateMs: 0, totalMs: 0, ...(timings as Partial<AnswerMeta['timings']> | null) },
    usage,
  }
  return c.json<TraceDetail>({ ...rest, meta })
})

/* ---------- Пробелы базы: вопросы без ответа, сгруппированные ---------- */

admin.get('/gaps', async (c) => {
  const days = Math.min(Math.max(Number(c.req.query('days')) || 30, 1), 365)
  const db = await getDb()
  const rows = await db.query<{
    id: string
    createdAt: string
    locale: Locale
    question: string
    condensed: string | null
    reason: RefusalReason | null
    best: number | null
  }>(
    `select id, created_at as "createdAt", locale, question, condensed_question as condensed,
            refusal->>'reason' as reason, (retrieval->>'bestScore')::float8 as best
     from chat_traces
     where mode = 'rag' and not found and refusal is not null
       and created_at > now() - make_interval(days => $1)
     order by created_at desc
     limit 500`,
    [days],
  )

  // Группировка по сходству основ слов (коэффициент Жаккара ≥ 0.5):
  // «сколько стоит брекеты» и «брекеты цена» попадут в одну группу.
  const groups: (GapGroup & { termSet: Set<string> })[] = []
  for (const r of rows) {
    const terms = new Set(queryTerms(r.condensed ?? r.question).terms)
    const similar = groups.find((g) => {
      if (!terms.size || !g.termSet.size) return g.questions[0].toLowerCase() === r.question.toLowerCase()
      const common = [...terms].filter((t) => g.termSet.has(t)).length
      return common / (terms.size + g.termSet.size - common) >= 0.5
    })
    const g =
      similar ??
      groups[
        groups.push({
          terms: [...terms],
          termSet: terms,
          questions: [],
          count: 0,
          lastAt: r.createdAt,
          locales: [],
          reasons: {},
          bestScore: null,
          traceIds: [],
        }) - 1
      ]
    g.count++
    if (g.questions.length < 5 && !g.questions.includes(r.question)) g.questions.push(r.question)
    if (!g.locales.includes(r.locale)) g.locales.push(r.locale)
    if (r.reason) g.reasons[r.reason] = (g.reasons[r.reason] ?? 0) + 1
    if (r.best !== null) g.bestScore = Math.max(g.bestScore ?? 0, Number(r.best))
    if (g.traceIds.length < 5) g.traceIds.push(r.id)
    if (similar) g.terms = g.terms.filter((t) => terms.has(t))
  }

  return c.json<GapGroup[]>(
    groups
      .sort((a, b) => b.count - a.count || String(b.lastAt).localeCompare(String(a.lastAt)))
      .map(({ termSet: _termSet, ...g }) => g),
  )
})

/* ---------- Статистика ---------- */

admin.get('/stats', async (c) => {
  const days = Math.min(Math.max(Number(c.req.query('days')) || 7, 1), 365)
  const db = await getDb()
  const since = `t.created_at > now() - make_interval(days => $1)`

  const [[main], [fb], byModel, attemptErrors, perDay] = await Promise.all([
    db.query<Record<string, number | null>>(
      `select
         count(*)::int as total,
         count(*) filter (where t.mode = 'rag')::int as rag,
         count(*) filter (where t.mode = 'no-rag')::int as "noRag",
         count(*) filter (where t.mode = 'rag' and t.found)::int as found,
         count(*) filter (where t.mode = 'rag' and not t.found and t.refusal is not null)::int as "notFound",
         count(*) filter (where not t.found and t.refusal is null and t.answer_kind is null and t.answer = '')::int as failed,
         count(*) filter (where t.answer_kind = 'kb')::int as "kindKb",
         count(*) filter (where t.answer_kind = 'general')::int as "kindGeneral",
         count(*) filter (where t.answer_kind = 'missing')::int as "kindMissing",
         count(*) filter (where t.answer_kind = 'offtopic')::int as "kindOfftopic",
         count(*) filter (where t.answer_kind = 'smalltalk')::int as "kindSmalltalk",
         count(*) filter (where t.refusal->>'reason' = 'below-threshold')::int as "belowThreshold",
         count(*) filter (where t.refusal->>'reason' = 'no-chunks')::int as "noChunks",
         count(*) filter (where t.refusal->>'reason' = 'model-declined')::int as "modelDeclined",
         count(*) filter (where exists (select 1 from jsonb_array_elements(t.attempts) a where a->>'status' <> 'ok'))::int as fallbacks,
         (percentile_cont(0.5) within group (order by (t.timings->>'totalMs')::float8)
            filter (where (t.timings->>'totalMs')::float8 > 0))::int as p50,
         (percentile_cont(0.95) within group (order by (t.timings->>'totalMs')::float8)
            filter (where (t.timings->>'totalMs')::float8 > 0))::int as p95
       from chat_traces t where ${since}`,
      [days],
    ),
    db.query<{ up: number; down: number; commented: number }>(
      `select count(*) filter (where f.rating = 'up')::int as up,
              count(*) filter (where f.rating = 'down')::int as down,
              count(*) filter (where f.comment is not null)::int as commented
       from feedback f join chat_traces t on t.id = f.trace_id where ${since}`,
      [days],
    ),
    db.query<Stats['byModel'][number]>(
      `select t.provider || ':' || t.model as model, count(*)::int as answers,
              coalesce(avg((t.timings->>'totalMs')::float8), 0)::int as "avgMs",
              count(f.rating) filter (where f.rating = 'down')::int as down
       from chat_traces t left join feedback f on f.trace_id = t.id
       where ${since} and t.model is not null
       group by 1 order by 2 desc`,
      [days],
    ),
    db.query<Stats['attemptErrors'][number]>(
      `select (a->>'provider') || ':' || (a->>'model') as model, count(*)::int as errors,
              (array_agg(a->>'detail' order by t.created_at desc))[1] as "lastDetail"
       from chat_traces t, jsonb_array_elements(t.attempts) a
       where ${since} and a->>'status' = 'error'
       group by 1 order by 2 desc`,
      [days],
    ),
    db.query<Stats['perDay'][number]>(
      `select to_char(date_trunc('day', t.created_at), 'YYYY-MM-DD') as day, count(*)::int as total,
              count(*) filter (where t.mode = 'rag' and t.refusal is not null)::int as "notFound",
              count(f.rating) filter (where f.rating = 'down')::int as down
       from chat_traces t left join feedback f on f.trace_id = t.id
       where ${since}
       group by 1 order by 1`,
      [days],
    ),
  ])

  const n = (v: number | null | undefined) => Number(v ?? 0)
  return c.json<Stats>({
    days,
    total: n(main.total),
    rag: n(main.rag),
    noRag: n(main.noRag),
    found: n(main.found),
    notFound: n(main.notFound),
    failed: n(main.failed),
    refusals: {
      'below-threshold': n(main.belowThreshold),
      'no-chunks': n(main.noChunks),
      'model-declined': n(main.modelDeclined),
    },
    kinds: Object.fromEntries(
      ANSWER_KINDS.map((k) => [k, n(main[`kind${k[0].toUpperCase()}${k.slice(1)}`])]),
    ) as Record<AnswerKind, number>,
    fallbacks: n(main.fallbacks),
    latency: { p50: main.p50 ?? null, p95: main.p95 ?? null },
    feedback: fb,
    byModel,
    attemptErrors,
    perDay,
  })
})

/* ---------- База знаний ---------- */

const DOC_COLUMNS = `d.id, d.locale, d.slug, d.title, d.version, d.updated_at as "updatedAt", d.is_price as "isPrice",
  d.source, d.drive_url as "driveUrl", count(c.id)::int as chunks, count(c.id) filter (where c.embed_model is distinct from $1)::int as stale`

admin.get('/documents', async (c) => {
  const db = await getDb()
  const rows = await db.query<DocumentRow>(
    `select ${DOC_COLUMNS} from documents d left join chunks c on c.document_id = d.id
     group by d.id order by d.slug, d.locale`,
    [embedModelLabel],
  )
  return c.json(rows)
})

async function loadDocument(id: number): Promise<DocumentDetail | null> {
  const db = await getDb()
  const [doc] = await db.query<DocumentRow & { bodyMd: string }>(
    `select ${DOC_COLUMNS}, d.body_md as "bodyMd" from documents d left join chunks c on c.document_id = d.id
     where d.id = $2 group by d.id`,
    [embedModelLabel, id],
  )
  if (!doc) return null
  const versions = await db.query<DocumentDetail['versions'][number]>(
    `select version, note, created_at as "createdAt", length(body_md)::int as size
     from document_versions where document_id = $1 order by version desc`,
    [id],
  )
  return { ...doc, versions }
}

admin.get('/documents/:id', async (c) => {
  const doc = await loadDocument(Number(c.req.param('id')))
  return doc ? c.json(doc) : c.json({ error: 'not-found' }, 404)
})

admin.get('/documents/:id/versions/:version', async (c) => {
  const db = await getDb()
  const [row] = await db.query<{ bodyMd: string }>(
    'select body_md as "bodyMd" from document_versions where document_id = $1 and version = $2',
    [Number(c.req.param('id')), Number(c.req.param('version'))],
  )
  return row ? c.json(row) : c.json({ error: 'not-found' }, 404)
})

/** Сохранить и переиндексировать. Сбой индексации не теряет текст: документ уже записан. */
async function saveAndReport(input: Parameters<typeof saveDocument>[0]): Promise<SaveResult> {
  try {
    return await saveDocument(input)
  } catch (err) {
    console.error('[admin/save]', err)
    const db = await getDb()
    const [doc] = await db.query<{ id: number; version: number }>(
      'select id, version from documents where locale = $1 and slug = $2',
      [input.locale, input.slug],
    )
    if (!doc) throw err
    return { id: doc.id, version: doc.version, changed: true, index: null, indexError: String((err as Error).message ?? err) }
  }
}

/** Документы из Google Drive правятся только в Drive: иначе следующая синхронизация затрёт правку. */
async function fromDrive(id: number): Promise<boolean> {
  const db = await getDb()
  const [row] = await db.query<{ source: string }>('select source from documents where id = $1', [id])
  return row?.source === 'drive'
}
const DRIVE_ONLY = { error: 'drive', message: 'Документ из Google Drive: правьте его в Drive' } as const

const saveSchema = z.object({ bodyMd: z.string().min(1).max(200_000), note: z.string().trim().max(200).optional() })

admin.put('/documents/:id', async (c) => {
  const data = await body(c.req.raw, saveSchema)
  if (!data) return c.json({ error: 'bad-request' }, 400)
  if (await fromDrive(Number(c.req.param('id')))) return c.json(DRIVE_ONLY, 409)
  const db = await getDb()
  const [doc] = await db.query<{ locale: Locale; slug: string }>('select locale, slug from documents where id = $1', [
    Number(c.req.param('id')),
  ])
  if (!doc) return c.json({ error: 'not-found' }, 404)
  return c.json(await saveAndReport({ locale: doc.locale, slug: doc.slug, bodyMd: data.bodyMd, note: data.note }))
})

admin.post('/documents', async (c) => {
  const data = await body(
    c.req.raw,
    saveSchema.extend({
      locale: z.enum(['ru', 'uz']),
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/),
      isPrice: z.boolean().optional(),
    }),
  )
  if (!data) return c.json({ error: 'bad-request' }, 400)
  // С подключённым Drive новые документы появляются из папки, а не отсюда.
  if (driveEnabled()) return c.json({ error: 'drive', message: 'Добавьте файл в папку Google Drive' }, 409)
  const db = await getDb()
  const [exists] = await db.query('select 1 from documents where locale = $1 and slug = $2', [data.locale, data.slug])
  if (exists) return c.json({ error: 'exists' }, 409)
  return c.json(await saveAndReport({ ...data, note: data.note ?? 'создан в админке' }))
})

admin.post('/documents/:id/rollback', async (c) => {
  const data = await body(c.req.raw, z.object({ version: z.number().int().positive() }))
  if (!data) return c.json({ error: 'bad-request' }, 400)
  if (await fromDrive(Number(c.req.param('id')))) return c.json(DRIVE_ONLY, 409)
  const db = await getDb()
  const [row] = await db.query<{ locale: Locale; slug: string; body_md: string }>(
    `select d.locale, d.slug, v.body_md from documents d
     join document_versions v on v.document_id = d.id and v.version = $2
     where d.id = $1`,
    [Number(c.req.param('id')), data.version],
  )
  if (!row) return c.json({ error: 'not-found' }, 404)
  // Откат — это новая версия со старым текстом: история не переписывается.
  return c.json(
    await saveAndReport({ locale: row.locale, slug: row.slug, bodyMd: row.body_md, note: `откат к v${data.version}` }),
  )
})

admin.delete('/documents/:id', async (c) => {
  if (await fromDrive(Number(c.req.param('id')))) return c.json(DRIVE_ONLY, 409)
  const db = await getDb()
  await db.query('delete from documents where id = $1', [Number(c.req.param('id'))])
  return c.json({ ok: true })
})

/** Вся база одним архивом: ru/prices.md, uz/faq.md… — формат content/rag, можно положить обратно в репозиторий. */
admin.get('/export', async () => {
  const db = await getDb()
  const docs = await db.query<{ locale: string; slug: string; body_md: string }>(
    'select locale, slug, body_md from documents order by locale, slug',
  )
  const archive = zip(docs.map((d) => ({ name: `${d.locale}/${d.slug}.md`, content: d.body_md })))
  const date = new Date().toISOString().slice(0, 10)
  return new Response(archive, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="skydental-knowledge-${date}.zip"`,
    },
  })
})

/* ---------- Синхронизация с Google Drive ---------- */

admin.get('/sync', async (c) => c.json<SyncStatus>(await syncStatus()))

/** «Проверить сейчас»: в обход интервала. */
admin.post('/sync', async (c) => c.json<SyncRunResult>(await syncFromDrive('admin', true)))

/* ---------- Записи на приём ---------- */

const SCOPES: AppointmentScope[] = ['upcoming', 'past', 'cancelled', 'all']

admin.get('/appointments', async (c) => {
  const q = c.req.query()
  return c.json<AppointmentList>(
    await listAppointments({
      scope: SCOPES.includes(q.scope as AppointmentScope) ? (q.scope as AppointmentScope) : 'upcoming',
      search: (q.q ?? '').trim().slice(0, 80),
      limit: Math.min(Math.max(Number(q.limit) || 100, 1), 500),
      offset: Math.max(Number(q.offset) || 0, 0),
    }),
  )
})

/** Отмена освобождает окно; строка в Google Таблице обновляется на месте. */
admin.post('/appointments/:code/cancel', async (c) => {
  const appointment = await cancelAppointment(c.req.param('code'))
  if (!appointment) return c.json({ error: 'not-found' }, 404)
  await pushToSheet().catch((err) => console.error('[sheet]', err))
  return c.json<CancelResult>({ appointment, sheet: await sheetStatus() })
})

/** «Отправить в таблицу»: повторить отправку того, что не ушло. */
admin.post('/appointments/sheet', async (c) => {
  const res = await pushToSheet()
  return c.json<SheetPushResponse>({ pushed: res?.pushed ?? null, error: res?.error ?? null, sheet: await sheetStatus() })
})

/* ---------- Модели и индекс ---------- */

const KNOWN_PROVIDERS = ['gemini', 'openai', 'openrouter', 'groq', 'deepseek', 'anthropic', 'ollama', 'local']

admin.get('/models', async (c) => {
  const db = await getDb()
  const [stats] = await db.query<{ chunks: number; stale: number; documents: number }>(
    `select (select count(*)::int from chunks) as chunks,
            (select count(*)::int from chunks where embed_model is distinct from $1) as stale,
            (select count(*)::int from documents) as documents`,
    [embedModelLabel],
  )
  return c.json<ModelsInfo>({
    providers: KNOWN_PROVIDERS.map((id) => ({ id, connected: providers.has(id) })),
    chain: await chainStatus(),
    embed: { label: embedModelLabel, ...stats, needsReindex: stats.stale > 0 || (stats.documents > 0 && stats.chunks === 0) },
    rag: { topK: env.RAG_TOP_K, minScore: env.RAG_MIN_SCORE },
    db: db.driver,
  })
})

admin.post('/models/ping', async (c) => {
  const data = await body(c.req.raw, z.object({ provider: z.string().min(1), model: z.string().min(1) }))
  if (!data) return c.json({ error: 'bad-request' }, 400)
  if (!providers.has(data.provider)) return c.json({ error: 'provider-not-connected' }, 400)
  const started = Date.now()
  try {
    const res = await generateText(
      {
        system: 'Reply with exactly one word: pong',
        messages: [{ role: 'user', text: 'ping' }],
        temperature: 0,
        maxTokens: 32,
      },
      [data],
      // Пинг — это и есть проверка «ожила ли модель», поэтому паузу он игнорирует.
      { force: true },
    )
    return c.json<PingResult>({ ok: true, ms: Date.now() - started, text: res.text.trim().slice(0, 80), attempts: res.attempts })
  } catch (err) {
    if (err instanceof ChainError) return c.json<PingResult>({ ok: false, ms: Date.now() - started, attempts: err.attempts })
    throw err
  }
})

admin.post('/models/reset', (c) => {
  resetCooldowns()
  return c.json({ ok: true })
})

admin.post('/reindex', async (c) => {
  const started = Date.now()
  const reports = await reindexAll()
  return c.json<ReindexResult>({
    documents: reports.length,
    total: reports.reduce((s, r) => s + r.total, 0),
    embedded: reports.reduce((s, r) => s + r.embedded, 0),
    reused: reports.reduce((s, r) => s + r.reused, 0),
    ms: Date.now() - started,
  })
})

/* ---------- Песочница: поиск и промпт без генерации ---------- */

admin.post('/sandbox', async (c) => {
  const data = await body(
    c.req.raw,
    z.object({
      question: z.string().trim().min(1).max(1000),
      locale: z.enum(['ru', 'uz']),
      topK: z.number().int().min(1).max(SHOW_LIMIT).optional(),
    }),
  )
  if (!data) return c.json({ error: 'bad-request' }, 400)
  const r = await retrieve(data.question, data.locale, data.topK)
  // Так же, как в answer.ts: порог не пройден — фрагменты в промпт не идут.
  const wouldRefuse: RefusalReason | null = !r.chunks.length
    ? 'no-chunks'
    : r.bestScore === null || r.bestScore < env.RAG_MIN_SCORE
      ? 'below-threshold'
      : null
  const retrieval: RetrievalInfo = {
    question: data.question,
    condensed: null,
    chunks: wouldRefuse ? r.chunks.map((ch) => ({ ...ch, n: null })) : r.chunks,
    bestScore: r.bestScore,
    threshold: env.RAG_MIN_SCORE,
    method: 'hybrid',
    ms: r.ms,
  }
  const req = ragRequest({
    question: data.question,
    locale: data.locale,
    history: [],
    chunks: retrieval.chunks,
    bestScore: r.bestScore,
    threshold: env.RAG_MIN_SCORE,
  })
  return c.json<SandboxResult>({ retrieval, prompt: { system: req.system, user: req.messages.at(-1)!.text }, wouldRefuse })
})

export default admin
