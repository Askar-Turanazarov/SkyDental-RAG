import { mkdir, readFile } from 'node:fs/promises'
import { env } from '../env.js'

/* ============================================================
   Подключение к Postgres.

   Весь SQL в проекте — обычные запросы с параметрами $1, $2…
   Так его легко читать на уроке, и он одинаково работает на двух
   драйверах:
   - postgres.js — Neon или любой Postgres с pgvector (DATABASE_URL);
   - PGlite — Postgres, собранный в WebAssembly, прямо в процессе
     Node. Нужен только для локальной разработки без Docker и без
     облака: данные лежат в папке .data/.
   ============================================================ */

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
  exec(text: string): Promise<void>
  readonly driver: 'postgres' | 'pglite'
}

let dbPromise: Promise<Db> | null = null

export function getDb(): Promise<Db> {
  dbPromise ??= connect().catch((err) => {
    // Не кэшируем неудачу: следующий запрос попробует снова.
    dbPromise = null
    throw err
  })
  return dbPromise
}

async function connect(): Promise<Db> {
  if (env.DATABASE_URL) {
    const { default: postgres } = await import('postgres')
    // prepare: false — Neon раздаёт соединения через pgbouncer в
    // режиме транзакций, где подготовленные запросы не живут.
    const sql = postgres(env.DATABASE_URL, { prepare: false, max: 5, idle_timeout: 20, onnotice: () => {} })
    return {
      driver: 'postgres',
      async query<T>(text: string, params: unknown[] = []) {
        return (await sql.unsafe(text, params as never[])) as unknown as T[]
      },
      async exec(text: string) {
        await sql.unsafe(text)
      },
    }
  }

  if (process.env.VERCEL) {
    throw new Error('DATABASE_URL не задан: на Vercel нужна внешняя база (Neon).')
  }

  const { PGlite } = await import('@electric-sql/pglite')
  const { vector } = await import('@electric-sql/pglite-pgvector')
  await mkdir('./.data', { recursive: true })
  const pg = new PGlite('./.data/pglite', { extensions: { vector } })
  await pg.waitReady
  const db: Db = {
    driver: 'pglite',
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows
    },
    async exec(text: string) {
      await pg.exec(text)
    },
  }
  // Встроенная база создаётся с нуля — схему применяем сразу.
  await db.exec(await schemaSql())
  return db
}

/**
 * Текст schema.sql. Читается только локально и из CLI
 * (npm run db:migrate): в функциях Vercel схему не применяем.
 */
function schemaSql(): Promise<string> {
  return readFile(new URL('./schema.sql', import.meta.url), 'utf8')
}

/** Применить схему. Идемпотентно. */
export async function migrate(): Promise<void> {
  const db = await getDb()
  await db.exec(await schemaSql())
}

/** Вектор в текстовый литерал pgvector: '[0.1,0.2,…]'. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => x.toFixed(7)).join(',')}]`
}
