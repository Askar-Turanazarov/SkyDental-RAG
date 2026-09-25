import { useT } from '../i18n/LocaleContext'
import { PhoneLink } from './PhoneLink'

const SECTIONS = ['services', 'about', 'faq', 'contacts'] as const

export function Footer() {
  const t = useT()

  return (
    <footer className="footer">
      <div className="shell">
        <div className="footer__grid">
          <div className="footer__brand">
            <p className="footer__name">SkyDental</p>
            <p className="footer__tagline">{t.footer.tagline}</p>
          </div>

          <nav className="footer__col" aria-labelledby="footer-nav">
            <h2 id="footer-nav" className="footer__heading">
              {t.footer.navTitle}
            </h2>
            <ul>
              {SECTIONS.map((id) => (
                <li key={id}>
                  <a href={`#${id}`}>{t.nav[id]}</a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="footer__col">
            <h2 className="footer__heading">{t.footer.contactsTitle}</h2>
            <ul>
              <li>
                <PhoneLink>{t.contacts.phone}</PhoneLink>
              </li>
              <li>
                <a href="https://t.me/skydental_uz" target="_blank" rel="noopener noreferrer">
                  {t.contacts.telegram}
                </a>
              </li>
              <li>{t.contacts.address}</li>
              <li>{t.contacts.hours}</li>
            </ul>
          </div>

          <div className="footer__col">
            <h2 className="footer__heading">{t.footer.legalTitle}</h2>
            <p data-placeholder="true" title={t.contacts.placeholderNote}>
              {t.footer.license}
            </p>
            <p>{t.footer.disclaimer}</p>
          </div>
        </div>

        {/* Узкая изразцовая кайма: подпись дизайна повторяется в конце
            страницы одной строкой, без повтора всего узора. */}
        <div className="footer__border" aria-hidden="true" />

        <p className="footer__copy">{t.footer.copyright}</p>
      </div>
    </footer>
  )
}
