import { useLocale, useT } from '../i18n/LocaleContext'
import type { Locale } from '../i18n/types'
import { useSegThumb } from './useSegThumb'

const OPTIONS: { value: Locale; short: string; full: string }[] = [
  { value: 'ru', short: 'RU', full: 'Русский' },
  { value: 'uz', short: 'UZ', full: 'Oʻzbekcha' },
]

/**
 * Сегментированный переключатель языка. Выбор одного из двух —
 * это radiogroup, а не две независимые кнопки, поэтому семантика
 * radio: скринридер объявляет «выбрано 1 из 2».
 *
 * Разметка общая с переключателем темы (.seg): два контрола рядом в
 * шапке должны читаться как один элемент интерфейса, а не как две
 * разные придумки.
 */
export function LangSwitcher() {
  const { locale, setLocale } = useLocale()
  const t = useT()
  const ref = useSegThumb<HTMLDivElement>(locale)

  return (
    <div ref={ref} className="seg" role="radiogroup" aria-label={t.nav.langLabel}>
      {OPTIONS.map((opt) => {
        const active = opt.value === locale
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            className="seg__opt"
            data-active={active}
            onClick={() => setLocale(opt.value)}
            lang={opt.value}
            title={opt.full}
          >
            <span aria-hidden="true">{opt.short}</span>
            <span className="sr-only">{opt.full}</span>
          </button>
        )
      })}
    </div>
  )
}

