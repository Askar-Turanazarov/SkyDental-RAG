import { useT } from '../i18n/LocaleContext'
import { CrownSvg } from '../graphics/CrownSvg'
import { IconArrowRight, IconStar } from '../graphics/icons'

/* Узор girih под героем — общий фон страницы, он в App. */
export function Hero() {
  const t = useT()

  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="shell hero__grid">
        <div className="hero__copy">
          <p className="eyebrow">
            <span className="dot" aria-hidden="true" />
            {t.hero.eyebrow}
          </p>

          <h1 id="hero-title" className="hero__title">
            {t.hero.titleLines.map((line, i) => (
              <span key={i} className="hero__line">
                {line}
              </span>
            ))}
          </h1>

          <p className="hero__lede">{t.hero.lede}</p>

          <div className="hero__ctas">
            {/* Основное действие — на запись. В шапке та же цель,
                так что на экране одно действие, а не два конкурирующих. */}
            <a className="btn btn--primary btn--lg" href="#contacts">
              {t.hero.ctaPrimary}
            </a>
            <a className="btn btn--quiet btn--lg" href="#services">
              {t.hero.ctaSecondary}
              <IconArrowRight size={18} />
            </a>
          </div>

          <ul className="trust">
            <li className="trust__item">
              <span className="trust__status" aria-hidden="true" />
              {t.hero.openUntil}
            </li>
            <li className="trust__item">
              <IconStar size={16} className="trust__star" />
              {t.hero.rating}
            </li>
            <li className="trust__item">{t.hero.patients}</li>
          </ul>
        </div>

        <div className="hero__art">
          <CrownSvg />
        </div>
      </div>
    </section>
  )
}
