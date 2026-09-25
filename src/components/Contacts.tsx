import { useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useT } from '../i18n/LocaleContext'
import { IconArrowUpRight, IconCheck, IconClock, IconPhone, IconPin, IconTelegram } from '../graphics/icons'
import { useReveal } from './useReveal'
import { PhoneLink } from './PhoneLink'
import { MAP_URL, TELEGRAM_URL } from '../config'

/** +998 и 9 цифр; допускаем ввод без кода страны — тогда 9 цифр. */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('998')) return '+' + digits
  if (digits.length === 9) return '+998' + digits
  return null
}

type Errors = Partial<Record<'name' | 'phone', string>>

export function Contacts() {
  const t = useT()
  const f = t.contacts.form
  const ref = useReveal<HTMLDivElement>()
  const uid = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)

  const [errors, setErrors] = useState<Errors>({})
  const [sent, setSent] = useState(false)

  /**
   * ЗАГЛУШКА ОТПРАВКИ. Бэкенда записи пока нет, поэтому форма
   * собирает текст заявки, копирует его и открывает Telegram клиники.
   * Когда появится эндпоинт записи — заменить тело этой функции
   * на fetch(); валидация и разметка останутся как есть. См. README.
   */
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const name = String(data.get('name') ?? '').trim()
    const phone = normalizePhone(String(data.get('phone') ?? ''))
    const serviceId = String(data.get('service') ?? '')

    const next: Errors = {}
    if (name.length < 2) next.name = f.errorName
    if (!phone) next.phone = f.errorPhone
    setErrors(next)

    // Фокус на первое ошибочное поле: скринридер сразу прочитает ошибку.
    if (next.name) return nameRef.current?.focus()
    if (next.phone) return phoneRef.current?.focus()

    const service = t.services.items.find((s) => s.id === serviceId)?.name
    const text = [f.title, `${f.name}: ${name}`, `${f.phone}: ${phone}`, service && `${f.service}: ${service}`]
      .filter(Boolean)
      .join('\n')

    // Копирование стартует синхронно, пока документ в фокусе, а вкладка
    // открывается в том же клике: после await Safari счёл бы window.open
    // всплывающим окном без жеста пользователя и заблокировал бы его.
    // Если буфер недоступен (нет HTTPS, запрет) — Telegram всё равно откроется.
    navigator.clipboard?.writeText(text).catch(() => {})
    setSent(true)
    window.open(TELEGRAM_URL, "_blank", "noopener")
  }

  const errId = (field: string) => `${uid}-${field}-err`

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

          <form className="card booking" onSubmit={onSubmit} noValidate>
            <h3 className="booking__title">{f.title}</h3>

            <div className="field">
              <label htmlFor={`${uid}-name`}>{f.name}</label>
              <input
                ref={nameRef}
                id={`${uid}-name`}
                name="name"
                type="text"
                autoComplete="name"
                placeholder={f.namePlaceholder}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? errId('name') : undefined}
              />
              {errors.name && (
                <p className="field__error" id={errId('name')}>
                  {errors.name}
                </p>
              )}
            </div>

            <div className="field">
              <label htmlFor={`${uid}-phone`}>{f.phone}</label>
              <input
                ref={phoneRef}
                id={`${uid}-phone`}
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={f.phonePlaceholder}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? errId('phone') : undefined}
              />
              {errors.phone && (
                <p className="field__error" id={errId('phone')}>
                  {errors.phone}
                </p>
              )}
            </div>

            <div className="field">
              <label htmlFor={`${uid}-service`}>{f.service}</label>
              <select id={`${uid}-service`} name="service" defaultValue="">
                <option value="">{f.servicePlaceholder}</option>
                {t.services.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" className="btn btn--secondary booking__submit">
              {f.submit}
            </button>

            <p className="booking__note">{f.note}</p>

            {/* role=status: сообщение об успехе объявляется без переноса фокуса. */}
            <p className="booking__success" role="status">
              {sent && (
                <>
                  <IconCheck size={18} />
                  {f.success}
                </>
              )}
            </p>
          </form>
        </div>
      </div>
    </section>
  )
}
