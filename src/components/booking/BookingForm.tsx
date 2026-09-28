import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  WEEKDAY_SHORT,
  addDays,
  clinicDate,
  isValidName,
  normalizePhone,
  weekdayOf,
} from '../../../shared/booking'
import type { Appointment, BookingError, Doctor, ServiceId, Slot } from '../../../shared/booking'
import type { Locale } from '../../../shared/protocol'
import { TELEGRAM_URL } from '../../config'
import { IconCheck, IconTelegram } from '../../graphics/icons'
import { useLocale, useT } from '../../i18n/LocaleContext'
import { fill } from '../../i18n/fill'
import type { Dict } from '../../i18n/types'
import { book, bookingApi, fetchDoctors, fetchSlots, onOpenBooking } from './bookingApi'
import type { BookPrefill } from './bookingApi'

/* ============================================================
   Форма записи: направление → врач → день → время → имя и телефон.

   Свободные окна приходят с сервера и не кешируются: их могли
   занять минуту назад. Окно всё равно может уйти, пока пациент
   вводит имя, — тогда сервер отвечает «занято», форма говорит
   об этом и заново загружает окна.
   ============================================================ */

type Form = Dict['contacts']['form']
type Errors = Partial<Record<'slot' | 'name' | 'phone' | 'form', string>>

/** «Сегодня / 29 сен», «Ср / 1 окт». */
function dayLabel(date: string, f: Form, locale: Locale, today: string) {
  const [, m, d] = date.split('-').map(Number)
  const top = date === today ? f.today : date === addDays(today, 1) ? f.tomorrow : WEEKDAY_SHORT[locale][weekdayOf(date) - 1]
  return { top, bottom: `${d} ${f.months[m - 1]}` }
}

export function BookingForm() {
  const t = useT()
  const f = t.contacts.form
  const { locale } = useLocale()
  const uid = useId()

  const [doctors, setDoctors] = useState<Doctor[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [loadTick, setLoadTick] = useState(0)
  const [service, setService] = useState<ServiceId | ''>('')
  const [doctorId, setDoctorId] = useState('')
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [slotsError, setSlotsError] = useState(false)
  const [slotsTick, setSlotsTick] = useState(0)
  const [date, setDate] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<Appointment | null>(null)

  // Окно, выбранное в чате: применяется, когда загрузятся врачи и окна.
  const prefill = useRef<BookPrefill | null>(null)
  const [prefillTick, setPrefillTick] = useState(0)
  const fromChat = useRef(false)

  const nameRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!bookingApi) return
    let alive = true
    setLoadError(false)
    fetchDoctors()
      .then((list) => alive && setDoctors(list))
      .catch(() => alive && setLoadError(true))
    return () => {
      alive = false
    }
  }, [loadTick])

  useEffect(
    () =>
      onOpenBooking((p) => {
        prefill.current = p
        fromChat.current = true
        setPrefillTick((n) => n + 1)
      }),
    [],
  )

  useEffect(() => {
    const p = prefill.current
    const doc = p && doctors?.find((d) => d.id === p.doctorId)
    if (!doc) return
    setDone(null)
    setErrors({})
    setService(doc.service)
    setDoctorId(doc.id)
    setSlotsTick((n) => n + 1) // тот же врач — всё равно перечитать окна
  }, [doctors, prefillTick])

  useEffect(() => {
    if (!doctorId) return setSlots(null)
    let alive = true
    setSlots(null)
    setSlotsError(false)
    fetchSlots(doctorId)
      .then((list) => {
        if (!alive) return
        setSlots(list)
        const p = prefill.current
        prefill.current = null
        const hit = p?.doctorId === doctorId ? list.find((s) => s.startsAt === p.startsAt) : undefined
        setDate(hit?.date ?? list[0]?.date ?? '')
        setStartsAt(hit?.startsAt ?? '')
      })
      .catch(() => alive && setSlotsError(true))
    return () => {
      alive = false
    }
  }, [doctorId, slotsTick])

  if (!bookingApi) {
    return (
      <div className="card booking" id="booking">
        <h3 className="booking__title">{f.title}</h3>
        <p className="booking__note">{f.offline}</p>
        <a className="btn btn--secondary booking__submit" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
          <IconTelegram size={18} /> {f.offlineCta}
        </a>
      </div>
    )
  }

  const today = clinicDate(new Date())
  const services = t.services.items.filter((s) => doctors?.some((d) => d.service === s.id))
  const serviceDoctors = doctors?.filter((d) => d.service === service) ?? []
  const days = [...new Set(slots?.map((s) => s.date))]
  const times = slots?.filter((s) => s.date === date) ?? []
  const errId = (field: string) => `${uid}-${field}-err`

  function chooseService(id: ServiceId | '') {
    const list = doctors?.filter((d) => d.service === id) ?? []
    setService(id)
    setDoctorId(list.length === 1 ? list[0].id : '')
    setStartsAt('')
  }

  function reset() {
    setDone(null)
    setErrors({})
    setStartsAt('')
    setSlotsTick((n) => n + 1)
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const name = String(data.get('name') ?? '').trim()
    const phone = String(data.get('phone') ?? '')

    const next: Errors = {}
    if (!startsAt) next.slot = f.errorSlot
    if (!isValidName(name)) next.name = f.errorName
    if (!normalizePhone(phone)) next.phone = f.errorPhone
    setErrors(next)
    // Фокус на первое ошибочное поле: скринридер сразу прочитает ошибку.
    if (next.slot) return timeRef.current?.focus()
    if (next.name) return nameRef.current?.focus()
    if (next.phone) return phoneRef.current?.focus()

    setSending(true)
    try {
      const res = await book({
        doctorId,
        startsAt,
        name,
        phone,
        comment: String(data.get('comment') ?? '').trim() || undefined,
        locale,
        source: fromChat.current ? 'chat' : 'site',
        website: String(data.get('website') ?? ''),
      })
      if ('appointment' in res) {
        setDone(res.appointment)
        fromChat.current = false
        form.reset()
        return
      }
      const messages: Partial<Record<BookingError, string>> = {
        taken: f.errorTaken,
        'slot-invalid': f.errorTaken,
        'too-many': f.errorTooMany,
        'rate-limit': f.errorRateLimit,
        'bad-phone': f.errorPhone,
        'bad-name': f.errorName,
      }
      if (res.error === 'taken' || res.error === 'slot-invalid') {
        setStartsAt('')
        setSlotsTick((n) => n + 1)
      }
      setErrors({ form: messages[res.error] ?? f.errorFailed })
    } catch {
      setErrors({ form: f.errorFailed })
    } finally {
      setSending(false)
    }
  }

  if (done) {
    const doctor = doctors?.find((d) => d.id === done.doctorId)
    const { top, bottom } = dayLabel(done.date, f, locale, today)
    return (
      <div className="card booking booking--done" id="booking" role="status">
        <span className="booking__done-icon">
          <IconCheck size={26} />
        </span>
        <h3 className="booking__title">{f.successTitle}</h3>
        <p>{fill(f.successText, { doctor: doctor?.name[locale] ?? '', date: `${top.toLowerCase()}, ${bottom}`, time: done.time })}</p>
        <p className="booking__code">
          <span>{f.successCode}</span>
          <strong>{done.code}</strong>
        </p>
        <p className="booking__note">{f.successNote}</p>
        <button type="button" className="btn btn--secondary" onClick={reset}>
          {f.another}
        </button>
      </div>
    )
  }

  return (
    <form className="card booking" id="booking" onSubmit={onSubmit} noValidate aria-busy={sending}>
      <div>
        <h3 className="booking__title">{f.title}</h3>
        <p className="booking__lede">{f.lede}</p>
      </div>

      {loadError && (
        <p className="booking__alert">
          {f.errorLoad}{' '}
          <button type="button" className="booking__retry" onClick={() => setLoadTick((n) => n + 1)}>
            {f.retry}
          </button>
        </p>
      )}

      <div className="field">
        <label htmlFor={`${uid}-service`}>{f.service}</label>
        <select
          id={`${uid}-service`}
          value={service}
          disabled={!doctors}
          onChange={(e) => chooseService(e.target.value as ServiceId | '')}
        >
          <option value="">{doctors || loadError ? f.servicePlaceholder : f.loading}</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {service && (
        <div className="field" role="group" aria-labelledby={`${uid}-doctor`}>
          <span className="field__label" id={`${uid}-doctor`}>
            {f.doctor}
          </span>
          <div className="booking__doctors">
            {serviceDoctors.map((d) => (
              <button
                key={d.id}
                type="button"
                className="pick"
                aria-pressed={d.id === doctorId}
                onClick={() => {
                  setDoctorId(d.id)
                  setStartsAt('')
                }}
              >
                <span className="pick__name">{d.name[locale]}</span>
                <span className="pick__meta">{d.specialty[locale]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {doctorId &&
        (slotsError ? (
          <p className="booking__alert">
            {f.errorLoad}{' '}
            <button type="button" className="booking__retry" onClick={() => setSlotsTick((n) => n + 1)}>
              {f.retry}
            </button>
          </p>
        ) : !slots ? (
          <p className="booking__muted">{f.loading}</p>
        ) : !slots.length ? (
          <p className="booking__muted">{f.noSlots}</p>
        ) : (
          <>
            <div className="field" role="group" aria-labelledby={`${uid}-day`}>
              <span className="field__label" id={`${uid}-day`}>
                {f.day}
              </span>
              <div className="slots slots--scroll">
                {days.map((d) => {
                  const { top, bottom } = dayLabel(d, f, locale, today)
                  return (
                    <button
                      key={d}
                      type="button"
                      className="slot slot--day"
                      aria-pressed={d === date}
                      onClick={() => {
                        setDate(d)
                        setStartsAt('')
                      }}
                    >
                      <span>{top}</span>
                      {bottom}
                    </button>
                  )
                })}
              </div>
            </div>

            <div
              className="field"
              role="group"
              aria-labelledby={`${uid}-time`}
              aria-describedby={errors.slot ? errId('slot') : undefined}
              ref={timeRef}
              tabIndex={-1}
            >
              <span className="field__label" id={`${uid}-time`}>
                {f.time}
              </span>
              <div className="slots">
                {times.map((s) => (
                  <button
                    key={s.startsAt}
                    type="button"
                    className="slot"
                    aria-pressed={s.startsAt === startsAt}
                    onClick={() => {
                      setStartsAt(s.startsAt)
                      setErrors((e) => ({ ...e, slot: undefined }))
                    }}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
              {errors.slot && (
                <p className="field__error" id={errId('slot')}>
                  {errors.slot}
                </p>
              )}
            </div>
          </>
        ))}

      <div className="field">
        <label htmlFor={`${uid}-name`}>{f.name}</label>
        <input
          ref={nameRef}
          id={`${uid}-name`}
          name="name"
          type="text"
          autoComplete="name"
          maxLength={80}
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
          maxLength={25}
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
        <label htmlFor={`${uid}-comment`}>{f.comment}</label>
        <textarea id={`${uid}-comment`} name="comment" rows={2} maxLength={500} placeholder={f.commentPlaceholder} />
      </div>

      {/* Ловушка для ботов: поле спрятано от людей и скринридеров. */}
      <div className="booking__hp" aria-hidden="true">
        <label>
          Website
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <button type="submit" className="btn btn--primary booking__submit" disabled={sending}>
        {sending ? f.sending : f.submit}
      </button>

      {errors.form && (
        <p className="booking__alert" role="alert">
          {errors.form}
        </p>
      )}

      <p className="booking__note">{f.note}</p>
    </form>
  )
}
