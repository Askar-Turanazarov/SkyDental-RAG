import { randomInt } from 'node:crypto'
import {
  BOOKING_DAYS,
  BOOKING_LEAD_MINUTES,
  SLOT_MINUTES,
  clinicDate,
  clinicTime,
  isValidName,
  normalizePhone,
  scheduleSlots,
} from '../../shared/booking.js'
import type { Appointment, BookingError, BookingRequest, Doctor, Slot } from '../../shared/booking.js'
import { getDb } from '../db/client.js'
import { listDoctors } from './doctors.js'

/* ============================================================
   ЗАПИСЬ НА ПРИЁМ.

   Свободное окно = окно по графику врача (doctors.hours)
                    − уже занятые записи
                    − прошедшее время и ближайший час.

   Двойной записи не бывает благодаря уникальному индексу в базе:
   (doctor_id, starts_at) среди активных записей. Два пациента
   жмут «Записаться» на одно окно в одну и ту же секунду — оба
   запроса доходят до insert, но Postgres пропустит только один;
   второй получает пустой ответ и сообщение «время уже занято».
   Проверка «окно свободно?» перед insert нужна только для
   понятной ошибки — гарантию даёт индекс, а не она.
   ============================================================ */

/** Сколько будущих записей может быть на один номер телефона. */
const MAX_PER_PHONE = 3

export class BookingFailure extends Error {
  constructor(readonly code: BookingError) {
    super(code)
  }
}

/** Окна записи на ближайшие дни: [с, по) — начиная с сегодняшней даты клиники. */
function bookingWindow(now = new Date()) {
  return {
    from: clinicDate(now),
    earliest: now.getTime() + BOOKING_LEAD_MINUTES * 60_000,
  }
}

/** Занятые окна врачей: множество «doctorId|ISO». */
async function takenSlots(doctorIds: string[], fromIso: string): Promise<Set<string>> {
  const db = await getDb()
  const rows = await db.query<{ doctor_id: string; starts_at: Date | string }>(
    `select doctor_id, starts_at from appointments
     where status = 'booked' and starts_at >= $2
       and doctor_id in (select jsonb_array_elements_text($1::text::jsonb))`,
    [JSON.stringify(doctorIds), fromIso],
  )
  return new Set(rows.map((r) => `${r.doctor_id}|${new Date(r.starts_at).toISOString()}`))
}

export interface DoctorSlots {
  doctor: Doctor
  slots: Slot[]
}

/** Свободные окна врачей (всех действующих или перечисленных) на BOOKING_DAYS дней. */
export async function freeSlots(filter: { doctorIds?: string[] } = {}, now = new Date()): Promise<DoctorSlots[]> {
  const doctors = (await listDoctors()).filter((d) => !filter.doctorIds || filter.doctorIds.includes(d.id))
  if (!doctors.length) return []
  const { from, earliest } = bookingWindow(now)
  const taken = await takenSlots(
    doctors.map((d) => d.id),
    new Date(earliest).toISOString(),
  )
  return doctors.map((doctor) => ({
    doctor,
    slots: scheduleSlots(doctor.hours, from, BOOKING_DAYS).filter(
      (s) => Date.parse(s.startsAt) >= earliest && !taken.has(`${doctor.id}|${s.startsAt}`),
    ),
  }))
}

/** Номер записи: SD- и 5 знаков без похожих (0/O, 1/I). */
function newCode(): string {
  const abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  return `SD-${Array.from({ length: 5 }, () => abc[randomInt(abc.length)]).join('')}`
}

export async function createAppointment(input: BookingRequest & { ipHash?: string }): Promise<Appointment> {
  const phone = normalizePhone(input.phone)
  if (!phone) throw new BookingFailure('bad-phone')
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (!isValidName(name)) throw new BookingFailure('bad-name')

  const doctor = (await listDoctors()).find((d) => d.id === input.doctorId)
  if (!doctor) throw new BookingFailure('doctor-not-found')

  // Окно должно быть в графике врача и в пределах записи: время
  // «10:30» у врача со сменой от 09:00 или дата через месяц не пройдут.
  const startsAt = new Date(input.startsAt)
  const iso = Number.isNaN(startsAt.getTime()) ? '' : startsAt.toISOString()
  const { from, earliest } = bookingWindow()
  const inSchedule = scheduleSlots(doctor.hours, from, BOOKING_DAYS).some((s) => s.startsAt === iso)
  if (!inSchedule || startsAt.getTime() < earliest) throw new BookingFailure('slot-invalid')

  const db = await getDb()
  const [{ n }] = await db.query<{ n: number }>(
    `select count(*)::int as n from appointments where status = 'booked' and patient_phone = $1 and starts_at > now()`,
    [phone],
  )
  if (n >= MAX_PER_PHONE) throw new BookingFailure('too-many')

  // on conflict … do nothing: занятое окно — пустой результат, а не
  // исключение. Так же ведут себя оба драйвера (Neon и PGlite).
  for (let attempt = 0; ; attempt++) {
    try {
      const rows = await db.query<{ code: string }>(
        `insert into appointments (code, doctor_id, service, starts_at, ends_at, patient_name, patient_phone,
           comment, locale, source, ip_hash)
         values ($1, $2, $3, $4, $4::timestamptz + make_interval(mins => $5), $6, $7, $8, $9, $10, $11)
         on conflict (doctor_id, starts_at) where status = 'booked' do nothing
         returning code`,
        [
          newCode(),
          doctor.id,
          doctor.service,
          iso,
          SLOT_MINUTES,
          name,
          phone,
          input.comment?.trim() || null,
          input.locale,
          input.source ?? 'site',
          input.ipHash ?? null,
        ],
      )
      if (!rows.length) throw new BookingFailure('taken')
      return {
        code: rows[0].code,
        doctorId: doctor.id,
        service: doctor.service,
        startsAt: iso,
        date: clinicDate(startsAt),
        time: clinicTime(startsAt),
      }
    } catch (err) {
      // Совпал номер записи (один шанс на десятки миллионов) — новый номер.
      if (attempt < 2 && /appointments_code/.test(String((err as Error).message))) continue
      throw err
    }
  }
}
