import { createSign } from 'node:crypto'
import { env } from '../env.js'

/* ============================================================
   Токен сервисного аккаунта Google.

   Сервисный аккаунт — «робот» с собственным e-mail: папку в Drive
   ему открывают так же, как человеку. Вход — JWT, подписанный его
   приватным ключом (RS256), обмененный на access token. Это пара
   десятков строк на node:crypto, поэтому без пакета googleapis.
   ============================================================ */

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

interface ServiceAccount {
  client_email: string
  private_key: string
}

let account: ServiceAccount | null | undefined
let cached: { token: string; expiresAt: number } | null = null

/** JSON ключа: целиком или в base64 (так его проще вставить в Vercel). */
export function serviceAccount(): ServiceAccount | null {
  if (account !== undefined) return account
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) return (account = null)
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  const parsed = JSON.parse(text) as ServiceAccount
  // Из панели Vercel перевод строки в ключе иногда приходит как «\n».
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
  return (account = parsed)
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url')

export async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const sa = serviceAccount()
  if (!sa) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON не задан')

  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }))
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.private_key)
  const assertion = `${head}.${claims}.${b64url(signature)}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!res.ok) throw new Error(`Google OAuth: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { access_token: string; expires_in: number }
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return cached.token
}
