import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

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
  setPref: (next: ThemePref) => void
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

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolved
    // Нативные контролы (select, скроллбары, автозаполнение) следуют
    // color-scheme, а не нашим токенам. Без этой строки в тёмной теме
    // выпадающий список услуг остался бы белым.
    root.style.colorScheme = resolved
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', SURFACE[resolved])
  }, [resolved])

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Выбор не переживёт перезагрузку — но в текущей сессии работает.
    }
  }, [])

  const value = useMemo<ThemeValue>(() => ({ pref, resolved, setPref }), [pref, resolved, setPref])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme вызван вне ThemeProvider')
  return ctx
}
