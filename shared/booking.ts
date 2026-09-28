import type { Locale } from './protocol.js'

/* ============================================================
   Запись на приём: общие для сайта и сервера типы и константы.
   ============================================================ */

/** Направления — те же id, что у услуг на сайте (i18n services.items). */
export const SERVICES = {
  implants: { ru: 'Имплантация', uz: 'Implantatsiya' },
  aligners: { ru: 'Прозрачные алайнеры', uz: 'Shaffof aylanerlar' },
  therapy: { ru: 'Лечение и каналы', uz: 'Davolash va kanallar' },
  hygiene: { ru: 'Гигиена и профилактика', uz: 'Gigiyena va profilaktika' },
  prosthetics: { ru: 'Протезирование', uz: 'Protezlash' },
  kids: { ru: 'Детский приём', uz: 'Bolalar qabuli' },
} as const satisfies Record<string, Record<Locale, string>>

export type ServiceId = keyof typeof SERVICES
export const SERVICE_IDS = Object.keys(SERVICES) as ServiceId[]

/** Дни недели по ISO: 1 — понедельник … 7 — воскресенье. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7
export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7]
export const WEEKDAY_SHORT: Record<Locale, string[]> = {
  ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  uz: ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'],
}

/** Смена: ['09:00', '14:00'] — приём с 9 до 14. */
export type Shift = [start: string, end: string]
/** График врача: день недели → смены. Дня нет — врач в этот день не принимает. */
export type WeekHours = Partial<Record<Weekday, Shift[]>>

export interface Doctor {
  /** Код латиницей из таблицы (karimov): к нему привязаны записи. */
  id: string
  name: Record<Locale, string>
  specialty: Record<Locale, string>
  service: ServiceId
  hours: WeekHours
  bio: Record<Locale, string>
}

/** Первичный приём длится час; окна идут от начала смены. */
export const SLOT_MINUTES = 60
/** Клиника в Ташкенте: UTC+5 круглый год, перехода на летнее время нет. */
export const CLINIC_UTC_OFFSET = '+05:00'
const OFFSET_MS = 5 * 3600_000
/** На сколько дней вперёд открыта запись. */
export const BOOKING_DAYS = 14
/** Ближайшее окно — не раньше чем через столько минут: клинике нужно время подготовиться. */
export const BOOKING_LEAD_MINUTES = 60

/* ---------- время клиники ---------- */

/** Дата по часам клиники: '2026-09-28'. */
export const clinicDate = (t: Date) => new Date(t.getTime() + OFFSET_MS).toISOString().slice(0, 10)
/** Время по часам клиники: '14:00'. */
export const clinicTime = (t: Date) => new Date(t.getTime() + OFFSET_MS).toISOString().slice(11, 16)
/** День недели ISO для даты '2026-09-28'. */
export function weekdayOf(date: string): Weekday {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return (d === 0 ? 7 : d) as Weekday
}
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}
/** '2026-09-28' + '14:00' по Ташкенту → момент времени. */
export const clinicInstant = (date: string, time: string) => new Date(`${date}T${time}:00${CLINIC_UTC_OFFSET}`)

/* ---------- окна приёма ---------- */

export interface Slot {
  /** По часам клиники. */
  date: string
  time: string
  /** Тот же момент в ISO (UTC) — так окно уходит в API. */
  startsAt: string
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * Окна по графику врача на days дней начиная с даты from: от начала
 * каждой смены через SLOT_MINUTES, пока приём целиком помещается в смену.
 * Занятость здесь не учитывается — её вычитает сервер.
 */
export function scheduleSlots(hours: WeekHours, from: string, days: number): Slot[] {
  const out: Slot[] = []
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i)
    for (const [start, end] of hours[weekdayOf(date)] ?? []) {
      for (let m = toMin(start); m + SLOT_MINUTES <= toMin(end); m += SLOT_MINUTES) {
        const time = toTime(m)
        out.push({ date, time, startsAt: clinicInstant(date, time).toISOString() })
      }
    }
  }
  return out
}

/* ---------- данные пациента ---------- */

/** Узбекский номер в любом виде → '+998 90 123 45 67'; не номер — null. */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '')
  if (d.length === 9) d = `998${d}`
  if (!/^998\d{9}$/.test(d)) return null
  return `+998 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10, 12)}`
}

/** Имя: буквы любого алфавита, пробел, дефис, апостроф (Oʻg‘li, O'Brien). */
export const isValidName = (s: string) => /^\p{L}[\p{L}\s'ʻʼ‘’.-]{1,79}$/u.test(s.trim())

/* ---------- API записи ---------- */

/** GET /api/booking/slots?doctor=<id> */
export interface SlotsResponse {
  doctorId: string
  slots: Slot[]
}

/** POST /api/booking */
export interface BookingRequest {
  doctorId: string
  startsAt: string
  name: string
  phone: string
  comment?: string
  locale: Locale
  /** Откуда пришла запись: форма на сайте или кнопка в чате. */
  source?: 'site' | 'chat'
  /** Ловушка для ботов: скрытое поле, человек его не заполняет. */
  website?: string
}

export interface Appointment {
  /** Номер записи для пациента: SD-7K3QX. */
  code: string
  doctorId: string
  service: ServiceId
  startsAt: string
  date: string
  time: string
}

export type BookingError =
  | 'bad-request'
  | 'bad-phone'
  | 'bad-name'
  | 'doctor-not-found'
  | 'slot-invalid'
  | 'taken'
  | 'too-many'
  | 'rate-limit'

export type BookingResponse = { appointment: Appointment } | { error: BookingError }
