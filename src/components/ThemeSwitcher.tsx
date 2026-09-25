import type { MouseEvent } from 'react'
import { useT } from '../i18n/LocaleContext'
import { useTheme } from '../theme/ThemeContext'
import type { ThemePref } from '../theme/ThemeContext'
import { IconAuto, IconMoon, IconSun } from '../graphics/icons'
import { useSegThumb } from './useSegThumb'

const OPTIONS: { value: ThemePref; Icon: typeof IconSun }[] = [
  { value: 'auto', Icon: IconAuto },
  { value: 'light', Icon: IconSun },
  { value: 'dark', Icon: IconMoon },
]

/**
 * Переключатель оформления. Тот же сегментированный контрол, что и у
 * языка (.seg): выбор одного значения из нескольких — это radiogroup,
 * а не набор независимых кнопок, поэтому скринридер объявляет
 * «выбрано 1 из 3».
 *
 * Иконки декоративны, смысл несёт подпись: на десктопе она визуально
 * скрыта (sr-only), в мобильном меню — видима, потому что там есть
 * место и подписи полезнее иконок.
 *
 * Новая тема раскрывается кругом от нажатой кнопки (ThemeContext).
 */
export function ThemeSwitcher({ withLabels = false }: { withLabels?: boolean }) {
  const t = useT()
  const { pref, setPref } = useTheme()
  const ref = useSegThumb<HTMLDivElement>(pref)

  const choose = (value: ThemePref, e: MouseEvent<HTMLButtonElement>) => {
    // С клавиатуры (Enter/пробел) у клика нулевые координаты —
    // тогда круг растёт из центра кнопки.
    const box = e.currentTarget.getBoundingClientRect()
    const fromPointer = e.detail > 0
    setPref(value, {
      x: fromPointer ? e.clientX : box.left + box.width / 2,
      y: fromPointer ? e.clientY : box.top + box.height / 2,
    })
  }

  return (
    <div ref={ref} className="seg" role="radiogroup" aria-label={t.theme.label}>
      {OPTIONS.map(({ value, Icon }) => {
        const active = value === pref
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            className="seg__opt seg__opt--icon"
            data-active={active}
            onClick={(e) => choose(value, e)}
            title={t.theme[value]}
          >
            <Icon size={18} />
            <span className={withLabels ? undefined : 'sr-only'}>{t.theme[value]}</span>
          </button>
        )
      })}
    </div>
  )
}
