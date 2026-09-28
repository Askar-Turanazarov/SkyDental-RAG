import { clinicDate, clinicTime } from '../../shared/booking.js'
import type { AppointmentList, AppointmentRow, AppointmentScope, SheetStatus } from '../../shared/admin.js'
import { getDb } from '../db/client.js'
import { serviceAccount } from '../drive/auth.js'
import { env } from '../env.js'
import { sheetEnabled, sheetUrl } from './sheet.js'

/* ============================================================
   Записи для админки: список с фильтрами, отмена и состояние
   копии в Google Таблице.

   Отмена не удаляет запись: статус cancelled освобождает окно
   (уникальный индекс держит только активные записи), а строка
   в Таблице обновляется на месте — «отменена».
   ============================================================ */

interface Row {
  code: string
  created_at: Date | string
  starts_at: Date | string
  doctor_id: string
  doctor: string
  service: AppointmentRow['service']
  patient_name: string
  patient_phone: string
  comment: string | null
  locale: AppointmentRow['locale']
  source: AppointmentRow['source']
  status: AppointmentRow['status']
  cancelled_at: Date | string | null
  synced: boolean
}

const iso = (v: Date | string) => new Date(v).toISOString()

function toRow(r: Row): AppointmentRow {
  const starts = new Date(r.starts_at)
  return {
    code: r.code,
    createdAt: iso(r.created_at),
    startsAt: starts.toISOString(),
    date: clinicDate(starts),
    time: clinicTime(starts),
    doctorId: r.doctor_id,
    doctor: r.doctor,
    service: r.service,
    patientName: r.patient_name,
    patientPhone: r.patient_phone,
    comment: r.comment,
    locale: r.locale,
    source: r.source,
    status: r.status,
    cancelledAt: r.cancelled_at ? iso(r.cancelled_at) : null,
    synced: r.synced,
  }
}

const COLUMNS = `
  a.code, a.created_at, a.starts_at, a.doctor_id, d.name_ru as doctor, a.service, a.patient_name,
  a.patient_phone, a.comment, a.locale, a.source, a.status, a.cancelled_at,
  (a.sheet_synced_at is not null and a.sheet_synced_at >= a.changed_at) as synced`

/** Предстоящие — по возрастанию времени (ближайшие сверху), остальные — свежие сверху. */
const SCOPES: Record<AppointmentScope, { where: string; order: string }> = {
  upcoming: { where: `a.status = 'booked' and a.starts_at >= now()`, order: 'a.starts_at asc' },
  past: { where: `a.status = 'booked' and a.starts_at < now()`, order: 'a.starts_at desc' },
  cancelled: { where: `a.status = 'cancelled'`, order: 'a.cancelled_at desc' },
  all: { where: 'true', order: 'a.starts_at desc' },
}

export async function sheetStatus(): Promise<SheetStatus> {
  const db = await getDb()
  const [[state], [pending]] = await Promise.all([
    db.query<{ last_ok_at: Date | string | null; last_error: string | null }>(
      `select last_ok_at, last_error from sheet_state where id = 1`,
    ),
    db.query<{ n: number }>(
      `select count(*)::int as n from appointments where sheet_synced_at is null or sheet_synced_at < changed_at`,
    ),
  ])
  const sa = serviceAccount()
  return {
    enabled: sheetEnabled(),
    problem: !env.GOOGLE_BOOKINGS_SHEET_ID
      ? 'не задан GOOGLE_BOOKINGS_SHEET_ID'
      : !sa
        ? 'нет ключа сервисного аккаунта (GOOGLE_SERVICE_ACCOUNT_JSON)'
        : null,
    url: sheetUrl(),
    serviceEmail: sa?.client_email ?? null,
    pending: pending?.n ?? 0,
    lastOkAt: state?.last_ok_at ? iso(state.last_ok_at) : null,
    lastError: state?.last_error ?? null,
  }
}

export async function listAppointments(opts: {
  scope: AppointmentScope
  search: string
  limit: number
  offset: number
}): Promise<AppointmentList> {
  const { where, order } = SCOPES[opts.scope]
  // Поиск по номеру, имени и телефону; в телефоне сравниваем только цифры.
  const filter = `${where} and ($1 = '' or a.code ilike '%' || $1 || '%' or a.patient_name ilike '%' || $1 || '%'
    or ($2 <> '' and regexp_replace(a.patient_phone, '\\D', '', 'g') like '%' || $2 || '%'))`
  const digits = opts.search.replace(/\D/g, '')
  const params = [opts.search, digits.length >= 3 ? digits : '']
  const db = await getDb()
  const [rows, [count], sheet] = await Promise.all([
    db.query<Row>(
      `select ${COLUMNS} from appointments a join doctors d on d.id = a.doctor_id
       where ${filter} order by ${order} limit ${opts.limit} offset ${opts.offset}`,
      params,
    ),
    db.query<{ total: number }>(`select count(*)::int as total from appointments a where ${filter}`, params),
    sheetStatus(),
  ])
  return { total: count.total, rows: rows.map(toRow), sheet }
}

/** Отменить активную запись. null — нет такой или уже отменена. */
export async function cancelAppointment(code: string): Promise<AppointmentRow | null> {
  const db = await getDb()
  const [row] = await db.query<Row>(
    `with a as (
       update appointments set status = 'cancelled', cancelled_at = now(), changed_at = now()
       where code = $1 and status = 'booked'
       returning *
     )
     select ${COLUMNS} from a join doctors d on d.id = a.doctor_id`,
    [code],
  )
  return row ? toRow(row) : null
}
