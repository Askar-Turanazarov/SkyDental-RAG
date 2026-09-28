/* ============================================================
   Ответы API админки (/api/admin/*). Общие для сервера и
   страницы admin.html, чтобы обе стороны не разошлись.
   ============================================================ */

import type { AnswerKind, AnswerMeta, Attempt, ChatMode, Locale, RefusalReason, RetrievalInfo } from './protocol.js'

export interface SessionInfo {
  /** false — ADMIN_PASSWORD не задан, админка выключена. */
  enabled: boolean
  authenticated: boolean
}

export type TraceFilter = 'all' | 'feedback' | 'down' | 'up' | 'commented' | 'notfound'

export interface TraceRow {
  id: string
  createdAt: string
  locale: Locale
  mode: ChatMode
  question: string
  /** Начало ответа (полный — в карточке трассы). */
  answer: string
  found: boolean
  /** Вид ответа; null — старые трассы, режим без RAG, отказ или сбой. */
  kind: AnswerKind | null
  refusalReason: RefusalReason | null
  provider: string | null
  model: string | null
  /** Хотя бы одна модель в цепочке не ответила. */
  fallback: boolean
  totalMs: number
  rating: 'up' | 'down' | null
  comment: string | null
}

export interface TraceList {
  total: number
  rows: TraceRow[]
}

export interface TraceDetail extends TraceRow {
  condensed: string | null
  retrieval: RetrievalInfo | null
  /** В той же форме, что приходит в чат, — чтобы показать тем же компонентом. */
  meta: AnswerMeta
}

export interface GapGroup {
  /** Общие основы слов вопросов группы. */
  terms: string[]
  questions: string[]
  count: number
  lastAt: string
  locales: Locale[]
  reasons: Partial<Record<RefusalReason, number>>
  /** Лучшая близость среди вопросов группы: насколько база «почти знала» ответ. */
  bestScore: number | null
  traceIds: string[]
}

export interface Stats {
  days: number
  total: number
  rag: number
  noRag: number
  found: number
  notFound: number
  failed: number
  refusals: Record<RefusalReason, number>
  /** Сколько ответов каждого вида (метка модели). */
  kinds: Record<AnswerKind, number>
  fallbacks: number
  latency: { p50: number | null; p95: number | null }
  feedback: { up: number; down: number; commented: number }
  byModel: { model: string; answers: number; avgMs: number; down: number }[]
  attemptErrors: { model: string; errors: number; lastDetail: string | null }[]
  perDay: { day: string; total: number; notFound: number; down: number }[]
}

export interface DocumentRow {
  id: number
  locale: Locale
  slug: string
  title: string
  version: number
  updatedAt: string
  isPrice: boolean
  chunks: number
  /** Кусков с векторами другой модели эмбеддингов. */
  stale: number
  /** 'drive' — документ из Google Drive: правится только там. */
  source: 'local' | 'drive'
  driveUrl: string | null
}

export interface DocumentVersion {
  version: number
  note: string | null
  createdAt: string
  size: number
}

export interface DocumentDetail extends DocumentRow {
  bodyMd: string
  versions: DocumentVersion[]
}

export interface IndexReport {
  documentId: number
  total: number
  embedded: number
  reused: number
}

export interface SaveResult {
  id: number
  version: number
  changed: boolean
  index: IndexReport | null
  /** Документ сохранён, но переиндексация не удалась (например, нет ключа эмбеддингов). */
  indexError?: string
}

export interface ModelsInfo {
  providers: { id: string; connected: boolean }[]
  chain: {
    provider: string
    model: string
    connected: boolean
    listed: boolean | null
    paused: { seconds: number; reason: string } | null
  }[]
  embed: { label: string; stale: number; chunks: number; documents: number; needsReindex: boolean }
  rag: { topK: number; minScore: number }
  db: string
}

export interface PingResult {
  ok: boolean
  ms: number
  text?: string
  attempts: Attempt[]
}

export interface ReindexResult {
  documents: number
  total: number
  embedded: number
  reused: number
  ms: number
}

export interface SandboxResult {
  retrieval: RetrievalInfo
  /** Ровно то, что увидит модель. */
  prompt: { system: string; user: string }
  /** Почему фрагменты не пойдут в промпт; null — пойдут. */
  wouldRefuse: RefusalReason | null
}

/* ---------- Синхронизация с Google Drive ---------- */

/** Кто запустил проверку: вопрос в чате, кнопка в админке или npm run seed. */
export type SyncTrigger = 'chat' | 'admin' | 'seed'
export type SyncAction = 'linked' | 'added' | 'updated' | 'removed' | 'error'

export interface SyncLogEntry {
  id: number
  createdAt: string
  trigger: SyncTrigger
  locale: Locale | null
  slug: string | null
  fileName: string | null
  action: SyncAction
  version: number | null
  linesAdded: number | null
  linesRemoved: number | null
  chunksEmbedded: number | null
  chunksTotal: number | null
  message: string | null
}

export interface SyncStatus {
  /** Заданы папка и ключ сервисного аккаунта. */
  enabled: boolean
  folderUrl: string | null
  /** E-mail сервисного аккаунта: на него «расшаривают» папку. */
  serviceEmail: string | null
  checkedAt: string | null
  intervalSec: number
  log: SyncLogEntry[]
}

export interface SyncRunResult {
  /** false — проверку уже делает другой запрос (или Drive выключен). */
  checked: boolean
  files: number
  changes: SyncLogEntry[]
}
