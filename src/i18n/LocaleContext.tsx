import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Dict, Locale } from './types'
import { ru } from './ru'
import { uz } from './uz'

const DICTS: Record<Locale, Dict> = { ru, uz }
const STORAGE_KEY = 'skydental.locale'

interface LocaleValue {
  locale: Locale
  setLocale: (next: Locale) => void
  t: Dict
}

const LocaleContext = createContext<LocaleValue | null>(null)

function isLocale(value: unknown): value is Locale {
  return value === 'ru' || value === 'uz'
}

/**
 * Начальный язык: сохранённый выбор → язык браузера → русский.
 * Русский взят дефолтом, потому что для коммерческих сайтов
 * Ташкента это основной язык обращения.
 */
function detectInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLocale(stored)) return stored
  } catch {
    // localStorage может быть недоступен (приватный режим, блокировка
    // сторонних данных). Это не повод падать — идём дальше к языку браузера.
  }

  const browser = navigator.language?.toLowerCase() ?? ''
  if (browser.startsWith('uz')) return 'uz'
  return 'ru'
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Выбор не сохранится между визитами — интерфейс всё равно
      // переключается, поэтому молча продолжаем.
    }
  }, [])

  // Атрибут lang нужен скринридерам для правильного произношения
  // и браузеру для переносов. Держим его в соответствии с локалью.
  useEffect(() => {
    document.documentElement.lang = DICTS[locale].htmlLang
  }, [locale])

  const value = useMemo<LocaleValue>(
    () => ({ locale, setLocale, t: DICTS[locale] }),
    [locale, setLocale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

function useLocaleContext(): LocaleValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) {
    throw new Error('useLocale и useT работают только внутри <LocaleProvider>')
  }
  return ctx
}

/** Текущий язык и переключатель. */
export function useLocale() {
  const { locale, setLocale } = useLocaleContext()
  return { locale, setLocale }
}

/** Словарь текущего языка. */
export function useT(): Dict {
  return useLocaleContext().t
}
