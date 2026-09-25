import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from '../theme/ThemeContext'
import type { ThemePref } from '../theme/ThemeContext'
import { IconAuto, IconMoon, IconSun } from '../graphics/icons'
import { ApiError, AuthError, api } from './api'

/* ============================================================
   Общие кусочки админки: загрузка данных, сегментный выбор,
   метки, пустые состояния, понятные тексты ошибок.
   ============================================================ */

const ERRORS: Record<string, string> = {
  'wrong-password': 'Неверный пароль.',
  'rate-limit': 'Слишком много попыток. Подождите несколько минут.',
  'admin-disabled': 'Админка выключена: в .env не задан ADMIN_PASSWORD.',
  'not-found': 'Не найдено — возможно, уже удалено.',
  exists: 'Документ с таким языком и slug уже есть.',
  'bad-request': 'Сервер не принял данные — проверьте поля.',
  'provider-not-connected': 'Провайдер не подключён: в .env нет его ключа.',
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return ERRORS[err.code] ?? `Ошибка сервера (${err.status}).`
  if (err instanceof TypeError) return 'Сервер недоступен. Запущен ли API (npm run dev)?'
  return String((err as Error)?.message ?? err)
}

interface Loaded<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  reload: () => void
}

/** GET-запрос с повторной загрузкой. Старые данные остаются на экране, пока идут новые. */
export function useLoad<T>(path: string | null): Loaded<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (path === null) return
    let alive = true
    setLoading(true)
    api<T>(path).then(
      (d) => {
        if (!alive) return
        setData(d)
        setError(null)
        setLoading(false)
      },
      (err) => {
        if (!alive || err instanceof AuthError) return
        setError(errorText(err))
        setLoading(false)
      },
    )
    return () => {
      alive = false
    }
  }, [path, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

/** Выбор одного значения из нескольких — тот же .seg, что на сайте. */
export function Seg<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          data-active={o.value === value}
          className="seg__opt"
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const THEMES: { value: ThemePref; label: string; Icon: typeof IconSun }[] = [
  { value: 'auto', label: 'Как в системе', Icon: IconAuto },
  { value: 'light', label: 'Светлая', Icon: IconSun },
  { value: 'dark', label: 'Тёмная', Icon: IconMoon },
]

export function ThemeSeg() {
  const { pref, setPref } = useTheme()
  return (
    <div className="seg" role="radiogroup" aria-label="Оформление">
      {THEMES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === pref}
          data-active={value === pref}
          className="seg__opt seg__opt--icon"
          title={label}
          onClick={() => setPref(value)}
        >
          <Icon size={18} />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  )
}

export type Tone = 'neutral' | 'accent' | 'good' | 'bad' | 'warn'

export const Tag = ({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) => (
  <span className="tag" data-tone={tone} title={title}>
    {children}
  </span>
)

export const Notice = ({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) => (
  <div className="notice" data-tone={tone} role={tone === 'bad' ? 'alert' : 'status'}>
    {children}
  </div>
)

export function SectionHead({ title, lede, actions }: { title: string; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sec-head">
      <div>
        <h1 className="sec-head__title">{title}</h1>
        {lede && <p className="sec-head__lede">{lede}</p>}
      </div>
      {actions && <div className="sec-head__actions">{actions}</div>}
    </header>
  )
}

/** Загрузка / ошибка / пусто — одинаково во всех разделах. */
export function LoadState({ loading, error, empty }: { loading: boolean; error: string | null; empty?: ReactNode }) {
  if (error) return <Notice tone="bad">{error}</Notice>
  if (loading) return <p className="muted">Загружаю…</p>
  return empty ? <div className="empty">{empty}</div> : null
}

export const REFUSAL_LABEL = {
  'below-threshold': 'ниже порога',
  'no-chunks': 'поиск пуст',
  'model-declined': 'модель не нашла',
} as const

export const f2 = (v: number | null) => (v === null ? '—' : v.toFixed(2))

/* ---------- Маршрут в hash: #/kb?doc=3 ---------- */

export interface Route {
  section: string
  params: URLSearchParams
}

function parseHash(): Route {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?')
  return { section: path || 'traces', params: new URLSearchParams(query) }
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function href(section: string, params?: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) if (v !== null && v !== undefined && v !== '') q.set(k, String(v))
  const s = q.toString()
  return `#/${section}${s ? `?${s}` : ''}`
}

export const go = (section: string, params?: Parameters<typeof href>[1]) => {
  location.hash = href(section, params)
}
