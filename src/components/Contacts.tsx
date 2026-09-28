import { useT } from '../i18n/LocaleContext'
import { IconArrowUpRight, IconClock, IconPhone, IconPin, IconTelegram } from '../graphics/icons'
import { useReveal } from './useReveal'
import { PhoneLink } from './PhoneLink'
import { BookingForm } from './booking/BookingForm'
import { MAP_URL, TELEGRAM_URL } from '../config'

export function Contacts() {
  const t = useT()
  const ref = useReveal<HTMLDivElement>()

  return (
    <section className="section section--raised" id="contacts" aria-labelledby="contacts-title">
      <div className="shell reveal" ref={ref}>
        <p className="eyebrow">{t.contacts.eyebrow}</p>
        <h2 id="contacts-title" className="section-title">
          {t.contacts.title}
        </h2>
        <p className="section-lede">{t.contacts.lede}</p>

        <div className="contacts">
          <div className="contacts__info">
            <dl className="contact-list">
              <div className="contact-list__row">
                <dt>
                  <IconPin size={20} />
                  {t.contacts.addressLabel}
                </dt>
                <dd data-placeholder="true" title={t.contacts.placeholderNote}>
                  {t.contacts.address}
                </dd>
              </div>
              <div className="contact-list__row">
                <dt>
                  <IconPhone size={20} />
                  {t.contacts.phoneLabel}
                </dt>
                <dd>
                  <PhoneLink>{t.contacts.phone}</PhoneLink>
                </dd>
              </div>
              <div className="contact-list__row">
                <dt>
                  <IconClock size={20} />
                  {t.contacts.hoursLabel}
                </dt>
                <dd>{t.contacts.hours}</dd>
              </div>
              <div className="contact-list__row">
                <dt>
                  <IconTelegram size={20} />
                  {t.contacts.telegramLabel}
                </dt>
                <dd>
                  <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                    {t.contacts.telegram}
                  </a>
                </dd>
              </div>
            </dl>

            {/* Схема вместо iframe карты: мгновенная загрузка, никаких
                сторонних cookie. Настоящая карта — по ссылке. */}
            <a className="map card" href={MAP_URL} target="_blank" rel="noopener noreferrer">
              <svg className="map__svg" viewBox="0 0 400 220" role="img" aria-label={t.contacts.mapAlt}>
                <rect width="400" height="220" className="map__ground" />
                <path d="M0 140 400 96" className="map__road map__road--main" />
                <path d="M150 0 190 220" className="map__road" />
                <path d="M300 0 280 220" className="map__road" />
                <path d="M0 40 400 20" className="map__road map__road--minor" />
                <path d="M0 200 400 180" className="map__road map__road--minor" />
                <rect x="205" y="60" width="54" height="36" rx="4" className="map__block map__block--clinic" />
                <rect x="60" y="30" width="70" height="44" rx="4" className="map__block" />
                <rect x="60" y="150" width="70" height="40" rx="4" className="map__block" />
                <rect x="310" y="120" width="70" height="50" rx="4" className="map__block" />
                <circle cx="232" cy="78" r="22" className="map__pulse" />
                <circle cx="232" cy="78" r="7" className="map__pin" />
              </svg>
              <span className="map__link">
                {t.contacts.mapLink}
                <IconArrowUpRight size={16} />
              </span>
            </a>
          </div>

          <BookingForm />
        </div>
      </div>
    </section>
  )
}
