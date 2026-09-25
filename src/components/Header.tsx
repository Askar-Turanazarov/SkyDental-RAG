import { useEffect, useState } from 'react'
import { useT } from '../i18n/LocaleContext'
import { LangSwitcher } from './LangSwitcher'
import { ThemeSwitcher } from './ThemeSwitcher'
import { IconClose, IconMenu } from '../graphics/icons'

const SECTIONS = ['services', 'about', 'faq', 'contacts'] as const

/**
 * Липкая шапка — одна из двух стеклянных поверхностей проекта
 * (функциональный слой). Под ней прокручивается girih-узор героя,
 * стекло подхватывает его цвет.
 *
 * Акцентная кнопка «Записаться» здесь — единственная залитая кнопка
 * на экране, пока шапка видна одновременно с героем. Поэтому в герое
 * основная кнопка тоже ведёт на запись, а вторичная — нейтральная.
 */
export function Header() {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)

  // Esc закрывает мобильное меню (привычное поведение любого оверлея).
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  // Меню не должно остаться открытым, если окно расширили до десктопа.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 56rem)')
    const onChange = () => mq.matches && setMenuOpen(false)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const close = () => setMenuOpen(false)

  return (
    <header className="header glass glass-scroll-edge">
      <div className="shell header__bar">
        <a className="brand" href="#top" onClick={close}>
          <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            <rect width="32" height="32" rx="8" className="brand__tile" />
            <path
              className="brand__star"
              d="M16 5.5 19.4 12l7.1 1-5.2 5 1.3 7-6.6-3.6-6.6 3.6 1.3-7-5.2-5 7.1-1z"
            />
          </svg>
          <span className="brand__name">SkyDental</span>
        </a>

        <nav
          id="site-nav"
          className="nav"
          data-open={menuOpen}
        >
          <ul className="nav__list">
            {SECTIONS.map((id) => (
              <li key={id}>
                <a className="nav__link" href={`#${id}`} onClick={close}>
                  {t.nav[id]}
                </a>
              </li>
            ))}
          </ul>

          {/* Вторичный стиль намеренно: пока меню открыто, под ним виден
              залитый акцентом CTA героя, а бюджет цвета — одна залитая
              кнопка на экран (liquid-glass.md). */}
          <a className="btn btn--secondary btn--lg nav__cta" href="#contacts" onClick={close}>
            {t.nav.book}
          </a>

          {/* Оформление в мобильном меню: в узкой шапке рядом с языком
              и бургером для него нет честного места. На десктопе эта
              строка скрыта, а переключатель стоит в шапке. */}
          <div className="nav__extra">
            <span className="nav__extra-label">
              {t.theme.label}
            </span>
            <ThemeSwitcher withLabels />
          </div>
        </nav>

        <div className="header__actions">
          <span className="header__theme">
            <ThemeSwitcher />
          </span>
          <LangSwitcher />
          <a className="btn btn--primary header__cta" href="#contacts" onClick={close}>
            {t.nav.book}
          </a>
          <button
            type="button"
            className="header__burger"
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            aria-label={menuOpen ? t.nav.menuClose : t.nav.menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <IconClose /> : <IconMenu />}
          </button>
        </div>
      </div>
    </header>
  )
}
