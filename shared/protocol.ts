/* ============================================================
   Протокол чата: общий для фронтенда, сервера и админки.

   POST /api/chat → поток SSE. События идут строго в порядке:
     retrieval  — что нашёл поиск (до генерации, поэтому видно сразу)
     token*     — куски ответа модели по мере генерации
     done       — итог: найден ли ответ, источники, модель, тайминги
   или error, если что-то пошло не так.

   Порядок «сначала поиск, потом ответ» — это и есть RAG, и студент
   видит его буквально: таблица найденных кусков появляется раньше,
   чем первое слово ответа.
   ============================================================ */

export type Locale = 'ru' | 'uz'
export type ChatMode = 'rag' | 'no-rag'

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface ChatRequest {
  question: string
  locale: Locale
  history: ChatTurn[]
  /** 'no-rag' — тот же вопрос модели без базы знаний, для сравнения. */
  mode?: ChatMode
}

export interface RetrievedChunk {
  chunkId: string
  locale: Locale
  /** Подпись источника: «Прайс-лист · Имплантация одного зуба». */
  source: string
  text: string
  /** Косинусная близость вектора вопроса и куска, 0…1. null — не попал в векторный топ. */
  vecScore: number | null
  /** Ранг в векторном поиске (1 — лучший). */
  vecRank: number | null
  /** Оценка ключевого поиска. null — ни одно слово не совпало. */
  textScore: number | null
  textRank: number | null
  /** Итоговая оценка Reciprocal Rank Fusion. */
  rrf: number
  /** Номер [n] в промпте; null — кусок не вошёл в промпт. */
  n: number | null
}

export interface RetrievalInfo {
  /** Вопрос как его задали. */
  question: string
  /** Самостоятельная формулировка follow-up вопроса («а сколько стоит?» → …). */
  condensed: string | null
  chunks: RetrievedChunk[]
  /** Лучшая векторная близость и порог, ниже которого бот отказывается. */
  bestScore: number | null
  threshold: number
  /** 'hybrid' — вектор + ключевые слова на сервере; 'keyword' — демо в браузере. */
  method: 'hybrid' | 'keyword'
  ms: number
  /** Свободные окна из системы записи, которые ушли в промпт (вопрос о записи). */
  schedule?: ScheduleInfo | null
}

export interface ScheduleInfo {
  /** Блок <schedule> как его видит модель: врачи и свободное время, без данных пациентов. */
  text: string
  doctors: number
  slots: number
}

/** Окно, предложенное ассистентом: кнопка «Записаться» под ответом открывает форму. */
export interface BookingOffer {
  doctorId: string
  doctor: string
  /** null — окно не выбрано: форма откроется на враче, время пациент выберет сам. */
  startsAt: string | null
  date: string | null
  time: string | null
}

export interface Attempt {
  provider: string
  model: string
  status: 'ok' | 'error' | 'skipped'
  /** Почему не получилось: «429 rate limit», «пауза ещё 42 с», «нет в списке моделей». */
  detail?: string
  ms: number
}

export type RefusalReason = 'below-threshold' | 'no-chunks' | 'model-declined'

/**
 * Какой ответ дала модель. Она сама ставит метку первой строкой
 * ([[kb]] и т. п.), сервер метку вырезает и кладёт сюда.
 *  - kb        — по материалам клиники, со сносками [n];
 *  - general   — общая справка о стоматологии, не из материалов;
 *  - missing   — вопрос о клинике, а в материалах ответа нет;
 *  - offtopic  — вопрос не о стоматологии;
 *  - smalltalk — приветствие, благодарность, прощание.
 */
export type AnswerKind = 'kb' | 'general' | 'missing' | 'offtopic' | 'smalltalk'
export const ANSWER_KINDS: readonly AnswerKind[] = ['kb', 'general', 'missing', 'offtopic', 'smalltalk']

export interface AnswerSource {
  n: number
  source: string
  text: string
}

export interface AnswerMeta {
  traceId: string | null
  mode: ChatMode
  /** Ответ опирается на материалы клиники (kind = kb). */
  found: boolean
  /** Вид ответа; null — режим без RAG, офлайн-отказ или сбой. */
  kind: AnswerKind | null
  /** Почему в материалах не нашлось ответа (kind = missing или офлайн-отказ). */
  refusal: { reason: RefusalReason; bestScore: number | null; threshold: number } | null
  /** Источники, на которые модель действительно сослалась. */
  sources: AnswerSource[]
  /** Окна для записи, которые ассистент предложил в ответе. */
  booking?: BookingOffer[]
  provider: string | null
  model: string | null
  attempts: Attempt[]
  timings: { retrieveMs: number; generateMs: number; totalMs: number }
  usage: { inputTokens?: number; outputTokens?: number } | null
}

export type ChatErrorCode = 'rate-limit' | 'unavailable' | 'bad-request'

export type ChatEvent =
  | { type: 'retrieval'; retrieval: RetrievalInfo }
  | { type: 'token'; text: string }
  | { type: 'done'; meta: AnswerMeta }
  | { type: 'error'; code: ChatErrorCode; message: string }

export interface FeedbackRequest {
  traceId: string
  rating: 'up' | 'down'
  comment?: string
}

/** Маркер, которым офлайн-модель local сообщает «в материалах ответа нет». */
export const NO_ANSWER = 'NO_ANSWER'
