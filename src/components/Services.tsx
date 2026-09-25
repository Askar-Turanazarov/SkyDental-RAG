import { useT } from '../i18n/LocaleContext'
import { SERVICE_ICONS } from '../graphics/icons'
import { useReveal } from './useReveal'

/**
 * Карточки услуг — ПЛОТНЫЕ, не стекло (liquid-glass.md › Review
 * checklist п.1). Цвет несёт только иконка в «изразцовой» плашке.
 */
export function Services() {
  const t = useT()
  const ref = useReveal<HTMLDivElement>()

  return (
    <section className="section" id="services" aria-labelledby="services-title">
      <div className="shell reveal" ref={ref}>
        <p className="eyebrow">{t.services.eyebrow}</p>
        <h2 id="services-title" className="section-title">
          {t.services.title}
        </h2>
        <p className="section-lede">{t.services.lede}</p>

        <ul className="services">
          {t.services.items.map((item) => {
            const Icon = SERVICE_ICONS[item.id]
            return (
              <li key={item.id} className="card service">
                <span className="service__icon">
                  <Icon size={26} />
                </span>
                <h3 className="service__name">{item.name}</h3>
                <p className="service__benefit">{item.benefit}</p>
                <p className="service__price">
                  <span className="service__from">{t.services.from}</span>{' '}
                  <span className="service__amount">{item.price}</span>{' '}
                  <span className="service__currency">UZS</span>
                </p>
              </li>
            )
          })}
        </ul>

        <p className="services__note">{t.services.priceNote}</p>
      </div>
    </section>
  )
}
