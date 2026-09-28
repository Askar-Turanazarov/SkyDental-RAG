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
