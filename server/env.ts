import { z } from 'zod'

/* ============================================================
   Настройки сервера. Всё берётся из переменных окружения:
   локально — из .env (см. .env.example), на Vercel — из
   Project Settings → Environment Variables.
   ============================================================ */

const num = (def: number) => z.coerce.number().default(def)
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined))

const schema = z.object({
  /** Postgres с pgvector (Neon). Пусто — встроенный PGlite в .data/ (только локально). */
  DATABASE_URL: optional,

  GEMINI_API_KEY: optional,
  OPENAI_API_KEY: optional,
  OPENROUTER_API_KEY: optional,
  GROQ_API_KEY: optional,
  DEEPSEEK_API_KEY: optional,
  ANTHROPIC_API_KEY: optional,
  /** Локальный Ollama, например http://localhost:11434/v1 */
  OLLAMA_BASE_URL: optional,

  /** Цепочка моделей для ответа, в порядке приоритета: provider:model,provider:model */
  LLM_CHAIN: z
    .string()
    .default('gemini:gemini-3.5-flash-lite,gemini:gemini-3.1-flash-lite,gemini:gemini-3.5-flash'),
  /** Уровень reasoning у Gemini 3: minimal | low | off (не передавать). */
  GEMINI_THINKING_LEVEL: z.enum(['minimal', 'low', 'off']).default('minimal'),

  /** Провайдер и модель эмбеддингов. Смена модели требует переиндексации. */
  EMBED_PROVIDER: z.string().default('gemini'),
  EMBED_MODEL: z.string().default('gemini-embedding-001'),

  RAG_TOP_K: num(5),
  /** Порог косинусной близости: ниже — честный отказ без вызова LLM. */
  RAG_MIN_SCORE: num(0.6),

  ADMIN_PASSWORD: optional,
  ADMIN_SECRET: optional,
  /** Соль для хеша IP: сам IP нигде не хранится. */
  IP_SALT: z.string().default('skydental-dev-salt'),

  /** Лимит чата: столько вопросов с одного IP за окно. */
  RATE_LIMIT_MAX: num(20),
  RATE_LIMIT_WINDOW_SEC: num(600),

  /** Папка базы знаний в Google Drive (id из адреса папки). Пусто — синхронизация выключена. */
  GOOGLE_DRIVE_FOLDER_ID: optional,
  /** JSON-ключ сервисного аккаунта Google: целиком или в base64. */
  GOOGLE_SERVICE_ACCOUNT_JSON: optional,
  /** Не чаще раза в столько секунд сервер спрашивает Drive, изменились ли файлы. */
  DRIVE_SYNC_INTERVAL_SEC: num(20),
  /** Google Таблица для копии записей на приём: id или ссылка. Пусто — только база. */
  GOOGLE_BOOKINGS_SHEET_ID: optional.transform((v) => v?.match(/\/d\/([\w-]+)/)?.[1] ?? v),

  /** Порт локального API. Не PORT: его подставляют хостинги и превью
   *  для веб-сервера, и API занял бы порт Vite. */
  API_PORT: num(8787),
})

export type Env = z.infer<typeof schema>

/* Значения из панели Vercel или скопированного .env бывают с пробелами,
   символом CR на конце или пустыми. Пустое считаем незаданным: тогда
   работает значение по умолчанию, а не падает вся функция. */
const cleaned = Object.fromEntries(
  Object.entries(process.env)
    .map(([k, v]) => [k, v?.trim()])
    .filter(([, v]) => v),
)

export const env: Env = schema.parse(cleaned)

/** Размерность векторов. Зафиксирована в схеме БД: vector(768). */
export const EMBED_DIM = 768
