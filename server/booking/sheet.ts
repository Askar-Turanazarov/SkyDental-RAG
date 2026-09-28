import { SERVICES, clinicDate, clinicTime } from '../../shared/booking.js'
import type { ServiceId } from '../../shared/booking.js'
import { getDb } from '../db/client.js'
import { accessToken, serviceAccount } from '../drive/auth.js'
import { env } from '../env.js'

/* ============================================================
   КОПИЯ ЗАПИСЕЙ В GOOGLE ТАБЛИЦЕ.

   Главная копия — таблица appointments в базе: только она умеет
   не пустить двойную запись. Google Таблица — зеркало для людей:
   администратор видит записи там, где привык, и может их
   распечатать или отфильтровать.

   Как попадает: после каждой записи (и отмены) сервер отправляет
   в Таблицу всё, что ещё не отправлено. Google не ответил — запись
   всё равно создана, а строка уйдёт со следующей попыткой: при
   следующей записи или по кнопке в админке. Уже отправленная
   запись ищется по номеру в колонке A и обновляется на месте,
   поэтому повтор не создаёт дублей, а сортировка листа не мешает.

   Значения пишутся как RAW: «=…» в имени пациента останется текстом,
   а не станет формулой.
   ============================================================ */

const TAB = 'Записи'
const HEADER = ['Номер', 'Создана', 'Дата', 'Время', 'Врач', 'Направление', 'Пациент', 'Телефон', 'Комментарий', 'Источник', 'Статус']
const LAST_COL = String.fromCharCode(64 + HEADER.length) // K
const API = 'https://sheets.googleapis.com/v4/spreadsheets'

export function sheetEnabled(): boolean {
  return Boolean(env.GOOGLE_BOOKINGS_SHEET_ID && serviceAccount())
}

export const sheetUrl = () =>
  env.GOOGLE_BOOKINGS_SHEET_ID ? `https://docs.google.com/spreadsheets/d/${env.GOOGLE_BOOKINGS_SHEET_ID}/edit` : null

const range = (a1: string) => encodeURIComponent(`'${TAB}'!${a1}`)

async function call(path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const qs = init.query ? `?${new URLSearchParams(init.query)}` : ''
  const res = await fetch(`${API}/${env.GOOGLE_BOOKINGS_SHEET_ID}${path}${qs}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) throw new Error(`Google Sheets: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.json() as Promise<Record<string, unknown>>
}

/** Номера записей из колонки A; нет листа «Записи» — создать его с шапкой. */
async function codesInSheet(): Promise<string[]> {
  let values: string[][]
  try {
    values = ((await call(`/values/${range('A:A')}`)).values as string[][] | undefined) ?? []
  } catch (err) {
    if (!/\b400\b/.test(String((err as Error).message))) throw err
    await call(':batchUpdate', {
      body: { requests: [{ addSheet: { properties: { title: TAB, gridProperties: { frozenRowCount: 1 } } } }] },
    })
    values = []
  }
  if (values[0]?.[0] !== HEADER[0])
    await call(`/values/${range(`A1:${LAST_COL}1`)}`, { method: 'PUT', query: { valueInputOption: 'RAW' }, body: { values: [HEADER] } })
  return values.map((r) => r[0] ?? '')
}

interface PendingRow {
  id: number
  code: string
  created_at: Date | string
  starts_at: Date | string
  doctor: string
  service: ServiceId
  patient_name: string
  patient_phone: string
  comment: string | null
  source: 'site' | 'chat'
  status: 'booked' | 'cancelled'
  read_at: Date | string
}

function rowValues(r: PendingRow): string[] {
  const created = new Date(r.created_at)
  const starts = new Date(r.starts_at)
  return [
    r.code,
    `${clinicDate(created)} ${clinicTime(created)}`,
    clinicDate(starts),
    clinicTime(starts),
    r.doctor,
    SERVICES[r.service]?.ru ?? r.service,
    r.patient_name,
    r.patient_phone,
    r.comment ?? '',
    r.source === 'chat' ? 'чат' : 'сайт',
    r.status === 'cancelled' ? 'отменена' : 'записан',
  ]
}

async function pending(): Promise<PendingRow[]> {
  const db = await getDb()
  return db.query<PendingRow>(
    `select a.id, a.code, a.created_at, a.starts_at, d.name_ru as doctor, a.service, a.patient_name,
            a.patient_phone, a.comment, a.source, a.status, now() as read_at
     from appointments a join doctors d on d.id = a.doctor_id
     where a.sheet_synced_at is null or a.sheet_synced_at < a.changed_at
     order by a.id limit 200`,
  )
}

async function writeRows(rows: PendingRow[]): Promise<void> {
  const at = new Map((await codesInSheet()).map((code, i) => [code, i + 1]))
  const updates: { range: string; values: string[][] }[] = []
  const appends: string[][] = []
  for (const r of rows) {
    const n = at.get(r.code)
    if (n) updates.push({ range: `'${TAB}'!A${n}:${LAST_COL}${n}`, values: [rowValues(r)] })
    else appends.push(rowValues(r))
  }
  if (updates.length) await call('/values:batchUpdate', { body: { valueInputOption: 'RAW', data: updates } })
  if (appends.length)
    await call(`/values/${range('A1')}:append`, {
      query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
      body: { values: appends },
    })
}

export interface SheetPushResult {
  pushed: number
  error: string | null
}

/**
 * Отправить в Таблицу всё, что ещё не отправлено. Не бросает
 * исключений: ошибка возвращается и записывается в sheet_state.
 * null — Таблица не настроена или отправку уже ведёт другой запрос.
 */
export async function pushToSheet(): Promise<SheetPushResult | null> {
  if (!sheetEnabled()) return null
  const db = await getDb()
  const locked = await db.query(
    `update sheet_state set locked_until = now() + interval '60 seconds'
     where id = 1 and locked_until < now() returning id`,
  )
  if (!locked.length) return null

  let pushed = 0
  try {
    // Несколько кругов: пока шла отправка, могли появиться новые записи.
    for (let round = 0; round < 3; round++) {
      const rows = await pending()
      if (!rows.length) break
      await writeRows(rows)
      await db.query(
        `update appointments set sheet_synced_at = $2
         where id in (select jsonb_array_elements_text($1::text::jsonb)::int)`,
        [JSON.stringify(rows.map((r) => r.id)), new Date(rows[0].read_at).toISOString()],
      )
      pushed += rows.length
    }
    await db.query(`update sheet_state set last_ok_at = now(), last_error = null where id = 1`)
    return { pushed, error: null }
  } catch (err) {
    const error = String((err as Error)?.message ?? err).slice(0, 500)
    console.error('[sheet]', error)
    await db.query(`update sheet_state set last_error = $1 where id = 1`, [error]).catch(() => {})
    return { pushed, error }
  } finally {
    await db.query(`update sheet_state set locked_until = 'epoch' where id = 1`).catch(() => {})
  }
}

/** Для ответа пациенту: отправить, но не держать ответ дольше ms. */
export async function pushToSheetSoon(ms = 4000): Promise<void> {
  await Promise.race([pushToSheet().catch((err) => console.error('[sheet]', err)), new Promise((r) => setTimeout(r, ms))])
}
