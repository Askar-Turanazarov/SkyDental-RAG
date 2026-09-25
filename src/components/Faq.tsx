import { useT } from '../i18n/LocaleContext'
import { IconChevronDown } from '../graphics/icons'
import { useReveal } from './useReveal'

/**
 * FAQ на нативных <details>/<summary>: клавиатура, скринридер и
 * поиск по странице (Ctrl+F находит текст в закрытых ответах в
 * Chromium) работают без единой строки JS.
 */
export function Faq() {
  const t = useT()
  const ref = useReveal<HTMLDivElement>()

  return (
    <section className="section" id="faq" aria-labelledby="faq-title">
      <div className="shell faq-layout reveal" ref={ref}>
        <div className="faq-layout__intro">
          <p className="eyebrow">{t.faq.eyebrow}</p>
          <h2 id="faq-title" className="section-title">
            {t.faq.title}
          </h2>
          <p className="section-lede">{t.faq.lede}</p>
        </div>

        <div className="faq">
          {t.faq.items.map((item, i) => (
            <details key={i} className="faq__item" name="faq">
              <summary className="faq__q">
                <span>{item.q}</span>
                <IconChevronDown size={20} className="faq__chevron" />
              </summary>
              <div className="faq__a">
                <p>{item.a}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
