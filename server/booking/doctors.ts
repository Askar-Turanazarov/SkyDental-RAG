import ExcelJS from 'exceljs'
import { SERVICE_IDS, SERVICES, SLOT_MINUTES, WEEKDAY_SHORT, WEEKDAYS } from '../../shared/booking.js'
import type { Doctor, ServiceId, Shift, WeekHours } from '../../shared/booking.js'
import type { Locale } from '../../shared/protocol.js'
import { getDb } from '../db/client.js'

/* ============================================================
   ВРАЧИ И ГРАФИК: doctors.xlsx в корне папки Google Drive.

   Первый лист, первая строка — шапка. Колонки ищутся по названию,
   порядок любой:
     Код            — латиницей: karimov. К нему привязаны записи,
                      поэтому код не меняют (ФИО менять можно)
     ФИО, Специальность, О враче            — по-русски
     ФИО (uz), Специальность (uz), О враче (uz)
     Направление    — услуга с сайта: «Имплантация» (или implants)
     Пн … Вс        — часы приёма: «09:00–14:00», несколько смен
                      через запятую; пусто — в этот день не принимает
   «О враче» — по желанию, остальное обязательно.

   Таблица читается целиком или никак: одна ошибка — и список врачей
   в базе остаётся прежним, а ошибка с номером строки уходит в журнал
   синхронизации. Врач, которого убрали из таблицы, не удаляется (у него
   могут быть записи), а становится неактивным: пропадает с сайта.

   Из той же таблицы собирается документ базы знаний «Врачи» (ru и uz):
   по нему бот отвечает, кто что лечит и когда принимает.
   ============================================================ */

export const DOCTORS_SLUG = 'doctors'

type TextField = 'id' | 'nameRu' | 'specialtyRu' | 'service' | 'bioRu' | 'nameUz' | 'specialtyUz' | 'bioUz'

const FIELDS: { key: TextField; title: string; required: boolean; width: number }[] = [
  { key: 'id', title: 'Код', required: true, width: 12 },
  { key: 'nameRu', title: 'ФИО', required: true, width: 22 },
  { key: 'specialtyRu', title: 'Специальность', required: true, width: 24 },
  { key: 'service', title: 'Направление', required: true, width: 24 },
  { key: 'bioRu', title: 'О враче', required: false, width: 50 },
  { key: 'nameUz', title: 'ФИО (uz)', required: true, width: 22 },
  { key: 'specialtyUz', title: 'Специальность (uz)', required: true, width: 24 },
  { key: 'bioUz', title: 'О враче (uz)', required: false, width: 50 },
]
const DAY_TITLES = WEEKDAY_SHORT.ru

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const norm = (s: string) => clean(s).toLowerCase()

/* ---------- часы приёма ---------- */

const SHIFT = /^(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})$/
const DAY_OFF = /^(выходной|нет|dam olish|-|–|—)$/i

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
export const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** «09:00–14:00, 15:00–19:00» → смены. Пустая ячейка или «выходной» — []. */
export function parseShifts(raw: string): Shift[] {
  const text = clean(raw)
  if (!text || DAY_OFF.test(text)) return []
  const shifts = text
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s): Shift => {
      const m = SHIFT.exec(s)
      if (!m) throw new Error(`«${s}» — нужно ЧЧ:ММ–ЧЧ:ММ, например 09:00–14:00`)
      const [h1, m1, h2, m2] = m.slice(1).map(Number)
      const start = h1 * 60 + m1
      const end = h2 * 60 + m2
      if (h1 > 23 || m1 > 59 || m2 > 59 || end > 24 * 60 || end <= start) throw new Error(`«${s}» — неверное время`)
      if (end - start < SLOT_MINUTES) throw new Error(`«${s}» — меньше часа, приём не поместится`)
      return [hhmm(start), hhmm(end)]
    })
    .sort((a, b) => minutes(a[0]) - minutes(b[0]))
  for (let i = 1; i < shifts.length; i++)
    if (minutes(shifts[i][0]) < minutes(shifts[i - 1][1]))
      throw new Error(`смены ${shifts[i - 1].join('–')} и ${shifts[i].join('–')} пересекаются`)
  return shifts
}

function serviceOf(raw: string): ServiceId | null {
  const n = norm(raw)
  return SERVICE_IDS.find((id) => id === n || norm(SERVICES[id].ru) === n || norm(SERVICES[id].uz) === n) ?? null
}

/* ---------- Excel → врачи ---------- */

export async function parseDoctorsXlsx(data: Buffer): Promise<Doctor[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data as unknown as ArrayBuffer)
  const sheet = wb.worksheets[0]
  if (!sheet) throw new Error('в файле нет листов')

  const header = new Map<string, number>()
  sheet.getRow(1).eachCell((c, col) => header.set(norm(c.text ?? ''), col))
  const absent = [...FIELDS.filter((f) => f.required).map((f) => f.title), ...DAY_TITLES].filter((t) => !header.has(norm(t)))
  if (absent.length) throw new Error(`в первой строке нет колонок ${absent.map((t) => `«${t}»`).join(', ')}`)

  const doctors: Doctor[] = []
  const errors: string[] = []
  const seen = new Set<string>()

  sheet.eachRow((row, n) => {
    if (n === 1) return
    const text = (title: string) => {
      const col = header.get(norm(title))
      return col ? clean(row.getCell(col).text ?? '') : ''
    }
    const v = Object.fromEntries(FIELDS.map((f) => [f.key, text(f.title)])) as Record<TextField, string>
    const days = DAY_TITLES.map(text)
    if (!Object.values(v).some(Boolean) && !days.some(Boolean)) return // пустая строка

    const at = `строка ${n}`
    const id = v.id.toLowerCase()
    for (const f of FIELDS) if (f.required && !v[f.key]) errors.push(`${at}: не заполнено «${f.title}»`)
    if (id && !/^[a-z][a-z0-9-]{1,39}$/.test(id)) errors.push(`${at}: код «${v.id}» — только латиница, цифры и дефис`)
    else if (id && seen.has(id)) errors.push(`${at}: код «${id}» уже есть выше`)
    seen.add(id)

    const service = serviceOf(v.service)
    if (v.service && !service)
      errors.push(`${at}: направление «${v.service}» — нужно одно из: ${SERVICE_IDS.map((s) => SERVICES[s].ru).join(', ')}`)

    const hours: WeekHours = {}
    WEEKDAYS.forEach((day, i) => {
      try {
        const shifts = parseShifts(days[i])
        if (shifts.length) hours[day] = shifts
      } catch (err) {
        errors.push(`${at}, ${DAY_TITLES[i]}: ${(err as Error).message}`)
      }
    })

    doctors.push({
      id,
      name: { ru: v.nameRu, uz: v.nameUz },
      specialty: { ru: v.specialtyRu, uz: v.specialtyUz },
      service: service ?? 'therapy',
      hours,
      bio: { ru: v.bioRu, uz: v.bioUz },
    })
  })

  if (errors.length)
    throw new Error(`${errors.slice(0, 5).join('; ')}${errors.length > 5 ? `; и ещё ошибок: ${errors.length - 5}` : ''}`)
  if (!doctors.length) throw new Error('в таблице нет ни одного врача')
  return doctors
}

/* ---------- врачи → Excel (npm run export:office) ---------- */

export async function doctorsToXlsx(doctors: Doctor[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Врачи')
  const [before, after] = [FIELDS.slice(0, 4), FIELDS.slice(4)]
  ws.columns = [
    ...before.map((f) => ({ header: f.title, width: f.width })),
    ...DAY_TITLES.map((d) => ({ header: d, width: 13 })),
    ...after.map((f) => ({ header: f.title, width: f.width })),
  ]
  for (const d of doctors) {
    const v: Record<TextField, string> = {
      id: d.id,
      nameRu: d.name.ru,
      specialtyRu: d.specialty.ru,
      service: SERVICES[d.service].ru,
      bioRu: d.bio.ru,
      nameUz: d.name.uz,
      specialtyUz: d.specialty.uz,
      bioUz: d.bio.uz,
    }
    ws.addRow([
      ...before.map((f) => v[f.key]),
      ...WEEKDAYS.map((day) => (d.hours[day] ?? []).map((s) => s.join('–')).join(', ')),
      ...after.map((f) => v[f.key]),
    ])
  }
  ws.eachRow((row) => (row.alignment = { wrapText: true, vertical: 'top' }))
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }]

  // Направление — выпадающий список, чтобы не ошибиться в названии.
  const serviceCol = ws.getColumn(before.findIndex((f) => f.key === 'service') + 1).letter
  const list = `"${SERVICE_IDS.map((s) => SERVICES[s].ru).join(',')}"`
  for (let r = 2; r <= 40; r++)
    ws.getCell(`${serviceCol}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [list] }

  const help = wb.addWorksheet('Как заполнять')
  help.getColumn(1).width = 110
  for (const line of [
    'Врачи читаются с первого листа. Строка — один врач.',
    'Код — латиницей (karimov). К нему привязаны записи пациентов: код не меняйте, ФИО и остальное — можно.',
    'Направление — выберите из списка: по нему врач показывается в форме записи.',
    'Пн … Вс — часы приёма, например 09:00–14:00. Две смены — через запятую: 09:00–13:00, 14:00–18:00. Пусто — не принимает.',
    'Первичный приём длится 1 час: окна для записи идут от начала смены.',
    'Врача, которого удалили из таблицы, нельзя выбрать на сайте, но его прошлые записи сохраняются.',
    'Ошибку в таблице (неверное время, пустое ФИО) видно в админке, в разделе «Синхронизация». Пока её не исправят, работает прежний список врачей.',
  ])
    help.addRow([line]).alignment = { wrapText: true }

  return Buffer.from(await wb.xlsx.writeBuffer())
}

/* ---------- документ базы знаний «Врачи» ---------- */

const DOC_TEXT: Record<Locale, { title: string; intro: string; service: string; hours: string; none: string }> = {
  ru: {
    title: 'Врачи клиники',
    intro:
      'Кто из врачей SkyDental чем занимается и когда принимает. Первичный приём — осмотр и план лечения с ценой — ' +
      'длится 1 час. Записаться можно через форму «Записаться на приём» на сайте: выберите направление, врача и ' +
      'свободное время. Ближайшие свободные окна подскажет ассистент на сайте. Если подходящего времени нет, ' +
      'позвоните администратору.',
    service: 'Направление',
    hours: 'Часы приёма',
    none: 'уточняйте у администратора',
  },
  uz: {
    title: 'Klinika shifokorlari',
    intro:
      'SkyDental shifokorlaridan kim nima bilan shugʻullanadi va qachon qabul qiladi. Birinchi qabul — koʻrik va ' +
      'narxi koʻrsatilgan davolash rejasi — 1 soat davom etadi. Saytdagi «Qabulga yozilish» shakli orqali yozilish ' +
      'mumkin: yoʻnalish, shifokor va boʻsh vaqtni tanlang. Eng yaqin boʻsh vaqtlarni saytdagi yordamchi aytib beradi. ' +
      'Mos vaqt boʻlmasa, administratorga qoʻngʻiroq qiling.',
    service: 'Yoʻnalish',
    hours: 'Qabul vaqti',
    none: 'administratordan aniqlang',
  },
}

/** «Пн, Ср, Пт 09:00–14:00; Вт, Чт 14:00–20:00» — дни с одинаковыми часами вместе. */
export function formatWeek(hours: WeekHours, locale: Locale): string {
  const groups = new Map<string, string[]>()
  for (const day of WEEKDAYS) {
    const shifts = hours[day]
    if (!shifts?.length) continue
    const key = shifts.map((s) => s.join('–')).join(', ')
    groups.set(key, [...(groups.get(key) ?? []), WEEKDAY_SHORT[locale][day - 1]])
  }
  return [...groups].map(([time, days]) => `${days.join(', ')} ${time}`).join('; ')
}

export function doctorsMarkdown(doctors: Doctor[], locale: Locale): string {
  const t = DOC_TEXT[locale]
  const blocks = [`# ${t.title}`, t.intro]
  for (const d of doctors) {
    blocks.push(`## ${d.name[locale]} — ${d.specialty[locale]}`)
    blocks.push(
      [`${t.service}: ${SERVICES[d.service][locale]}.`, d.bio[locale], `${t.hours}: ${formatWeek(d.hours, locale) || t.none}.`]
        .filter(Boolean)
        .join(' '),
    )
  }
  return `${blocks.join('\n\n')}\n`
}

/* ---------- таблица doctors ---------- */

/**
 * Записать список врачей одним запросом: новых добавить, знакомых
 * обновить, отсутствующих в списке — сделать неактивными. Один
 * оператор — одна транзакция: полусохранённого списка не бывает.
 */
export async function saveDoctors(doctors: Doctor[]): Promise<void> {
  const db = await getDb()
  const rows = doctors.map((d, i) => ({
    id: d.id,
    sort: i,
    name_ru: d.name.ru,
    name_uz: d.name.uz,
    specialty_ru: d.specialty.ru,
    specialty_uz: d.specialty.uz,
    service: d.service,
    hours: d.hours,
    bio_ru: d.bio.ru,
    bio_uz: d.bio.uz,
  }))
  await db.query(
    `with incoming as (
       select * from jsonb_to_recordset($1::text::jsonb) as x(id text, sort int, name_ru text, name_uz text,
         specialty_ru text, specialty_uz text, service text, hours jsonb, bio_ru text, bio_uz text)
     ), upserted as (
       insert into doctors (id, sort, name_ru, name_uz, specialty_ru, specialty_uz, service, hours, bio_ru, bio_uz, active)
       select id, sort, name_ru, name_uz, specialty_ru, specialty_uz, service, hours, bio_ru, bio_uz, true from incoming
       on conflict (id) do update set sort = excluded.sort, name_ru = excluded.name_ru, name_uz = excluded.name_uz,
         specialty_ru = excluded.specialty_ru, specialty_uz = excluded.specialty_uz, service = excluded.service,
         hours = excluded.hours, bio_ru = excluded.bio_ru, bio_uz = excluded.bio_uz, active = true, updated_at = now()
       returning id
     )
     update doctors set active = false, updated_at = now()
     where active and id not in (select id from incoming)`,
    [JSON.stringify(rows)],
  )
}

interface DoctorRow {
  id: string
  name_ru: string
  name_uz: string
  specialty_ru: string
  specialty_uz: string
  service: ServiceId
  hours: WeekHours
  bio_ru: string
  bio_uz: string
}

/** Действующие врачи в порядке таблицы. */
export async function listDoctors(): Promise<Doctor[]> {
  const db = await getDb()
  const rows = await db.query<DoctorRow>(
    `select id, name_ru, name_uz, specialty_ru, specialty_uz, service, hours, bio_ru, bio_uz
     from doctors where active order by sort, id`,
  )
  return rows.map((r) => ({
    id: r.id,
    name: { ru: r.name_ru, uz: r.name_uz },
    specialty: { ru: r.specialty_ru, uz: r.specialty_uz },
    service: r.service,
    hours: r.hours,
    bio: { ru: r.bio_ru, uz: r.bio_uz },
  }))
}
