import { createHmac } from 'node:crypto'
import { getDb } from './db/client.js'
import { env } from './env.js'

/* ============================================================
   Ограничение частоты запросов к чату.

   Чат публичный, а каждый вопрос тратит квоту LLM. Счётчик живёт
   в Postgres (у функций Vercel нет общей памяти): одна строка на
   хеш IP, окно RATE_LIMIT_WINDOW_SEC. Сам IP не хранится —
   только HMAC от него с солью.
   ============================================================ */

export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'local'
}

export function hashIp(ip: string): string {
  return createHmac('sha256', env.IP_SALT).update(ip).digest('hex').slice(0, 16)
}

/** true — лимит превышен. */
export async function overLimit(
  key: string,
  max = env.RATE_LIMIT_MAX,
  windowSec = env.RATE_LIMIT_WINDOW_SEC,
): Promise<boolean> {
  const db = await getDb()
  const [row] = await db.query<{ count: number }>(
    `insert into rate_limits (key, window_start, count) values ($1, now(), 1)
     on conflict (key) do update set
       count = case when rate_limits.window_start < now() - make_interval(secs => $2) then 1
                    else rate_limits.count + 1 end,
       window_start = case when rate_limits.window_start < now() - make_interval(secs => $2) then now()
                           else rate_limits.window_start end
     returning count`,
    [key, windowSec],
  )
  return Number(row.count) > max
}
