import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { SessionInfo } from '../../shared/admin'
import { IconArrowUpRight } from '../graphics/icons'
import { api, setUnauthorizedHandler } from './api'
import { Notice, ThemeSeg, errorText, href, useHashRoute } from './ui'
import { Traces } from './sections/Traces'
import { Gaps } from './sections/Gaps'
import { Stats } from './sections/Stats'
import { Knowledge } from './sections/Knowledge'
import { Sync } from './sections/Sync'
import { Models } from './sections/Models'
import { Sandbox } from './sections/Sandbox'
import { Bookings } from './sections/Bookings'

/* ============================================================
   Админка RAG. Один пароль (ADMIN_PASSWORD), сессия — подписанная
   httpOnly-cookie. Разделы идут в порядке жизненного цикла RAG:
   что спросили → чего не нашли → как в целом → поправить базу →
   модели → проверить поиск руками. Отдельно — записи на приём.
   ============================================================ */

const SECTIONS = [
  { id: 'traces', title: 'Диалоги и отзывы', hint: 'Вопросы, найденные фрагменты, оценки' },
  { id: 'gaps', title: 'Пробелы базы', hint: 'На что бот не нашёл ответа' },
  { id: 'stats', title: 'Статистика', hint: 'Отказы, fallback, задержка' },
  { id: 'kb', title: 'База знаний', hint: 'Документы, версии, экспорт' },
  { id: 'sync', title: 'Синхронизация', hint: 'Google Drive и журнал изменений' },
  { id: 'models', title: 'Модели', hint: 'Цепочка LLM и эмбеддинги' },
  { id: 'sandbox', title: 'Песочница поиска', hint: 'Поиск и промпт без генерации' },
  { id: 'bookings', title: 'Записи', hint: 'Приёмы, отмена, Google Таблица' },
] as const

type SessionState = SessionInfo | 'loading' | { error: string }

export function AdminApp() {
  const [session, setSession] = useState<SessionState>('loading')

  useEffect(() => {
    setUnauthorizedHandler(() => setSession({ enabled: true, authenticated: false }))
    api<SessionInfo>('/session').then(setSession, (err) => setSession({ error: errorText(err) }))
  }, [])

  if (session === 'loading') return <div className="adm-center muted">Загружаю…</div>
  if ('error' in session) {
    return (
      <div className="adm-center">
        <Notice tone="bad">{session.error}</Notice>
      </div>
    )
  }
  if (!session.enabled) {
    return (
      <div className="adm-center">
        <div className="card login">
          <h1 className="login__title">Админка выключена</h1>
          <p className="muted">
            Задайте <code>ADMIN_PASSWORD</code> (и желательно <code>ADMIN_SECRET</code>) в <code>.env</code> и перезапустите
            сервер. На Vercel — в Settings → Environment Variables.
          </p>
        </div>
      </div>
    )
  }
  if (!session.authenticated) return <Login onDone={() => setSession({ enabled: true, authenticated: true })} />
  return <Shell onLogout={() => setSession({ enabled: true, authenticated: false })} />
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/login', { body: { password } })
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <div className="adm-center">
      <form className="card login" onSubmit={submit}>
        <p className="eyebrow">SkyDental · RAG</p>
        <h1 className="login__title">Вход в админку</h1>
        <label className="field">
          <span className="field__label">Пароль</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn btn--primary" disabled={busy || !password}>
          {busy ? 'Проверяю…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const route = useHashRoute()
  const current = SECTIONS.find((s) => s.id === route.section) ?? SECTIONS[0]

  useEffect(() => {
    document.title = `${current.title} · Админка SkyDental`
  }, [current])

  const logout = async () => {
    await api('/logout', { body: {} }).catch(() => {})
    onLogout()
  }

  return (
    <div className="adm">
      <header className="adm-top">
        <a className="adm-top__brand" href={href('traces')}>
          SkyDental <span className="adm-top__rag">RAG</span>
        </a>
        <div className="adm-top__actions">
          <ThemeSeg />
          <a className="btn btn--quiet btn--small" href="./" target="_blank" rel="noopener">
            Сайт <IconArrowUpRight size={16} />
          </a>
          <button type="button" className="btn btn--secondary btn--small" onClick={logout}>
            Выйти
          </button>
        </div>
      </header>

      <div className="adm-body">
        <nav className="adm-nav" aria-label="Разделы">
          {SECTIONS.map((s) => (
            <a key={s.id} href={href(s.id)} aria-current={s.id === current.id ? 'page' : undefined}>
              <span className="adm-nav__title">{s.title}</span>
              <span className="adm-nav__hint">{s.hint}</span>
            </a>
          ))}
        </nav>

        <main className="adm-main" key={current.id}>
          {current.id === 'traces' && <Traces params={route.params} />}
          {current.id === 'gaps' && <Gaps />}
          {current.id === 'stats' && <Stats />}
          {current.id === 'kb' && <Knowledge params={route.params} />}
          {current.id === 'sync' && <Sync />}
          {current.id === 'models' && <Models />}
          {current.id === 'sandbox' && <Sandbox />}
          {current.id === 'bookings' && <Bookings />}
        </main>
      </div>
    </div>
  )
}
