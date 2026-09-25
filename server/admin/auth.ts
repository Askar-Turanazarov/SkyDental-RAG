import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { env } from '../env.js'

/* ============================================================
   Вход в админку. Один общий пароль (ADMIN_PASSWORD) — для
   клиники и учебного проекта этого достаточно, аккаунты не нужны.

   После входа браузер получает cookie «срок.подпись», где подпись —
   HMAC срока секретом ADMIN_SECRET. Подделать её без секрета нельзя,
   хранить сессии на сервере не нужно (у функций Vercel нет общей
   памяти). Cookie httpOnly: скрипты страницы её не видят.
   ============================================================ */

const COOKIE = 'sd_admin'
const TTL_SEC = 7 * 24 * 60 * 60

export const adminEnabled = () => Boolean(env.ADMIN_PASSWORD)

/** Секрет подписи. Без ADMIN_SECRET выводится из пароля и соли — работает, но лучше задать явно. */
function secret(): string {
  return env.ADMIN_SECRET ?? createHash('sha256').update(`admin:${env.ADMIN_PASSWORD}:${env.IP_SALT}`).digest('hex')
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('hex')

function safeEqual(a: string, b: string): boolean {
  // Сравниваем хеши одинаковой длины: время сравнения не выдаёт, сколько символов совпало.
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function checkPassword(password: string): boolean {
  return adminEnabled() && safeEqual(password, env.ADMIN_PASSWORD!)
}

export function isAuthenticated(c: Context): boolean {
  if (!adminEnabled()) return false
  const token = getCookie(c, COOKIE)
  if (!token) return false
  const [exp, sig] = token.split('.')
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false
  return safeEqual(sig, sign(exp))
}

export function startSession(c: Context) {
  const exp = String(Math.floor(Date.now() / 1000) + TTL_SEC)
  setCookie(c, COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/api/admin',
    maxAge: TTL_SEC,
  })
}

export function endSession(c: Context) {
  deleteCookie(c, COOKIE, { path: '/api/admin' })
}

/** Всё под /api/admin, кроме входа, — только с действующей cookie. */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (!adminEnabled()) return c.json({ error: 'admin-disabled' }, 503)
  if (!isAuthenticated(c)) return c.json({ error: 'unauthorized' }, 401)
  await next()
}
