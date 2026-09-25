import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'

/**
 * Оформление сайта.
 *
 * Базовое решение из плана — следовать системе (dark-mode.md прямо
 * не советует app-level переключатель). Но по опыту посетителей в
 * Узбекистане системную тему меняли единицы, а тёмный лендинг для
 * них выглядит поломкой. Компромисс: «Авто» остаётся значением по
 * умолчанию и честно следует `prefers-color-scheme`, а ручной выбор
 * — это осознанное переопределение, которое запоминается.
 *
 * Тема резолвится в JS и пишется атрибутом `data-theme` на <html>.
 * За счёт этого в CSS остаётся ОДИН источник правды для тёмной
 * палитры (`:root[data-theme='dark']`), а не две копии — под
 * media-запросом и под атрибутом. Мерцание при загрузке снимает
 * встроенный скрипт в <head> (см. index.html), который выставляет
 * тот же атрибут до первой отрисовки.
 */
export type ThemePref = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'skydental.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Совпадает с --surface из tokens.css: цвет строки статуса мобильных браузеров. */
const SURFACE: Record<ResolvedTheme, string> = { light: '#ffffff', dark: '#0a1420' }

interface ThemeValue {
  /** Что выбрал человек: включая «Авто». */
  pref: ThemePref
  /** Что реально показано на экране: только light или dark. */
  resolved: ResolvedTheme
  /** from — точка на экране (обычно место клика), из которой новая
      тема раскроется кругом. Без неё тема меняется мгновенно. */
  setPref: (next: ThemePref, from?: Point) => void
}

interface Point {
  x: number
  y: number
}

const ThemeContext = createContext<ThemeValue | null>(null)

function isPref(value: unknown): value is ThemePref {
  return value === 'auto' || value === 'light' || value === 'dark'
}

function readStoredPref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isPref(stored)) return stored
  } catch {
    // Приватный режим или запрет на хранение данных. Не повод падать —
    // просто следуем системе, как будто выбора ещё не было.
  }
  return 'auto'
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.dataset.theme = resolved
  // Нативные контролы (select, скроллбары, автозаполнение) следуют
  // color-scheme, а не нашим токенам. Без этой строки в тёмной теме
  // выпадающий список услуг остался бы белым.
  root.style.colorScheme = resolved
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', SURFACE[resolved])
}

/** Анимировать смену темы можно, если браузер умеет View Transitions
    и человек не просил убрать движение. */
function canAnimate(): boolean {
  return (
    typeof document.startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readStoredPref)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  // Системную тему слушаем всегда, а не только в режиме «Авто»:
  // человек может переключиться на «Авто» в любой момент, и значение
  // должно быть уже актуальным.
  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedTheme = pref === 'auto' ? system : pref

  useEffect(() => applyTheme(resolved), [resolved])

  const setPref = useCallback((next: ThemePref, from?: Point) => {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Выбор не переживёт перезагрузку — но в текущей сессии работает.
    }

    const nextResolved = next === 'auto' ? systemTheme() : next
    const root = document.documentElement
    // Анимация — только когда экран действительно меняется: «Авто»
    // при совпадающей системной теме ничего не перекрашивает.
    if (!from || nextResolved === root.dataset.theme || !canAnimate()) {
      setPrefState(next)
      return
    }

    // Радиус — до самого дальнего угла окна: круг должен накрыть всё.
    const r = Math.hypot(
      Math.max(from.x, window.innerWidth - from.x),
      Math.max(from.y, window.innerHeight - from.y),
    )
    root.style.setProperty('--vt-x', `${from.x}px`)
    root.style.setProperty('--vt-y', `${from.y}px`)
    root.style.setProperty('--vt-r', `${r}px`)

    // Браузер снимает страницу «до», вызывает колбэк и снимает «после».
    // Поэтому внутри тема должна примениться синхронно: атрибут на
    // <html> ставим сами, а React-состояние — через flushSync, чтобы
    // переключатели успели отрисовать новый выбор к снимку.
    document.startViewTransition(() => {
      applyTheme(nextResolved)
      flushSync(() => setPrefState(next))
    })
  }, [])

  const value = useMemo<ThemeValue>(() => ({ pref, resolved, setPref }), [pref, resolved, setPref])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme вызван вне ThemeProvider')
  return ctx
}
