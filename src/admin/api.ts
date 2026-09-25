/* Запросы к /api/admin/*. Cookie сессии браузер отправляет сам. */

export class AuthError extends Error {}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`)
  }
}

/** Слушатель «сессия кончилась» — AdminApp показывает форму входа. */
let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
    headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  })
  if (res.status === 401 && path !== '/login') {
    onUnauthorized()
    throw new AuthError('unauthorized')
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(res.status, data.error ?? 'error')
  }
  return (await res.json()) as T
}

const dateTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
export const fmtDate = (iso: string) => dateTime.format(new Date(iso))

export const fmtMs = (ms: number | null) => (ms === null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${ms} мс`)

export const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '—')

export function download(filename: string, content: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}
