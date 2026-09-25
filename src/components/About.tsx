import { useT } from '../i18n/LocaleContext'
import { useReveal } from './useReveal'

export function About() {
  const t = useT()
  const ref = useReveal<HTMLDivElement>()

  return (
    <section className="section section--raised" id="about" aria-labelledby="about-title">
      <div className="shell reveal" ref={ref}>
        <p className="eyebrow">{t.about.eyebrow}</p>
        <h2 id="about-title" className="section-title">
          {t.about.title}
        </h2>
        <p className="section-lede">{t.about.lede}</p>

        {/* Показатели — список пар «значение / подпись», поэтому <dl>. */}
        <dl className="stats">
          {t.about.stats.map((s) => (
            <div key={s.label} className="stats__item">
              <dt className="stats__label">{s.label}</dt>
              <dd className="stats__value">{s.value}</dd>
            </div>
          ))}
        </dl>

        <div className="about__cols">
          <div className="about__body">
            {t.about.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>

          {/* Врезка о происхождении палитры: сайт объясняет свой же дизайн,
              и это единственный текст, где упомянута связь изразца и фарфора. */}
          <aside className="craft" aria-labelledby="craft-title">
            <svg className="craft__tile" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
              <rect x="4" y="4" width="56" height="56" rx="10" className="craft__bg" />
              <g className="craft__star">
                <rect x="20" y="20" width="24" height="24" />
                <rect x="20" y="20" width="24" height="24" transform="rotate(45 32 32)" />
              </g>
              <circle cx="32" cy="32" r="5" className="craft__core" />
            </svg>
            <h3 id="craft-title" className="craft__title">
              {t.about.craftTitle}
            </h3>
            <p className="craft__body">{t.about.craftBody}</p>
          </aside>
        </div>
      </div>
    </section>
  )
}
