import { SERVICES, WEEKDAY_SHORT, addDays, clinicDate, clinicTime, weekdayOf } from '../../shared/booking.js'
import type { Doctor, ServiceId, Slot, Weekday } from '../../shared/booking.js'
import type { BookingOffer, Locale, ScheduleInfo } from '../../shared/protocol.js'
import { freeSlots } from './appointments.js'
import type { DoctorSlots } from './appointments.js'

/* ============================================================
   Свободные окна для ассистента.

   Спросили о записи или свободном времени — сервер сам достаёт
   свободные окна из таблицы записей и кладёт их в промпт блоком
   <schedule>. Модель видит только время, врача и направление:
   имён и телефонов пациентов в блоке нет и быть не может.

   Предложив окно, модель ставит в конце ответа метку
   [[book:karimov 2026-09-30 10:00]]. Сервер вырезает метки из
   потока, сверяет с настоящими свободными окнами (выдуманное
   окно кнопкой не станет) и отдаёт их клиенту — под ответом
   появляются кнопки «Записаться», открывающие форму.
   ============================================================ */

/** Апострофы узбекской латиницы бывают любыми: ʻ ʼ ‘ ’ ' `. */
const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ‘’`]/g, "'").replace(/ё/g, 'е')

const INTENT =
  /запис|свободн|окн[оаеу]|окош|при[её]м|принима|расписани|график|когда|время|сегодня|завтра|недел|понедельник|вторник|сред[уаы](?![а-я])|четверг|пятниц|суббот|воскресень|утр|вечер|yozil|bo'sh|qabul|jadval|vaqt|qachon|bugun|ertaga|indinga|hafta|dushanba|seshanba|chorshanba|payshanba|juma|shanba|yakshanba|ertalab|kechqurun/

/** Слова, по которым понятно направление. */
const SERVICE_WORDS: Record<ServiceId, RegExp> = {
  implants: /имплант|implant/,
  aligners: /[аэ]лайнер|брекет|прикус|выравн|ортодонт|aylaner|elayner|breket|tishlam|ortodont/,
  therapy: /кариес|пломб|канал|эндодонт|терапевт|лечить зуб|лечение зуб|karies|plomba|kanal|terapevt|davola/,
  hygiene: /чистк|гигиен|налет|камн|отбел|gigiyena|tozala|oqart/,
  prosthetics: /коронк|винир|протез|ортопед|koronka|vinir|protez|ortoped/,
  kids: /ребен|детск|детей|сын|доч|bola|farzand|o'g'il|qizim/,
}

const WEEKDAY_WORDS: [Weekday, RegExp][] = [
  [1, /понедельник|dushanba/],
  [2, /вторник|seshanba/],
  [3, /сред[уаы](?![а-я])|chorshanba/],
  [4, /четверг|payshanba/],
  [5, /пятниц|juma/],
  [6, /суббот|(?<![a-z])shanba/],
  [7, /воскресень|yakshanba/],
]

const MONTHS: Record<Locale, string[]> = {
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  uz: ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'],
}

const TEXT: Record<
  Locale,
  { now: string; intro: string; doctor: string; service: string; none: string; noDoctors: string; tz: string }
> = {
  ru: {
    now: 'Сейчас',
    tz: 'по Ташкенту',
    intro:
      'Свободные окна для записи на первичный приём (60 минут). Показаны ближайшие дни или дни, подходящие под вопрос, — не все.',
    doctor: 'Врач',
    service: 'направление',
    none: 'свободных окон в ближайшие 14 дней нет',
    noDoctors: 'Врачей для записи в системе пока нет.',
  },
  uz: {
    now: 'Hozir',
    tz: 'Toshkent vaqti',
    intro:
      'Birinchi qabulga (60 daqiqa) yozilish uchun boʻsh vaqtlar. Eng yaqin kunlar yoki savolga mos kunlar koʻrsatilgan — hammasi emas.',
    doctor: 'Shifokor',
    service: "yo'nalish",
    none: "yaqin 14 kunda boʻsh vaqt yoʻq",
    noDoctors: 'Tizimda yozilish uchun shifokorlar hozircha yoʻq.',
  },
}

const dayName = (date: string, locale: Locale) => {
  const [, m, d] = date.split('-').map(Number)
  return `${WEEKDAY_SHORT[locale][weekdayOf(date) - 1].toLowerCase()} ${d} ${MONTHS[locale][m - 1]}`
}

/** Основы имени и фамилии: «Каримов» → «карим» ловит «Каримову», «Каримова». */
function nameStems(d: Doctor): string[] {
  const words = `${d.name.ru} ${d.name.uz}`.split(/\s+/).map(norm).filter((w) => w.length >= 3)
  return [...new Set(words.map((w) => (w.length > 5 ? w.slice(0, w.length - 2) : w)))]
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mentions = (text: string, stem: string) => new RegExp(`(?<![\\p{L}])${escape(stem)}`, 'u').test(text)

export function namedDoctors(text: string, doctors: Doctor[]): Doctor[] {
  const t = norm(text)
  return doctors.filter((d) => nameStems(d).some((s) => mentions(t, s)))
}

export interface ScheduleContext {
  info: ScheduleInfo
  /** Все свободные окна выбранных врачей — для сверки меток [[book:…]]. */
  slots: DoctorSlots[]
  /** День подходит под пожелание из вопроса («завтра», «в субботу»). */
  wanted: (date: string) => boolean
}

/**
 * Блок <schedule> для промпта, если вопрос о записи или свободном времени.
 * null — вопрос не об этом, или записи нет (нет врачей в базе).
 */
export async function scheduleContext(texts: string[], locale: Locale, now = new Date()): Promise<ScheduleContext | null> {
  const t = norm(texts.filter(Boolean).join('\n'))
  const all = await freeSlots({}, now)
  if (!all.length) return null
  const doctors = all.map((x) => x.doctor)
  const named = namedDoctors(t, doctors)
  const services = (Object.keys(SERVICE_WORDS) as ServiceId[]).filter((s) => SERVICE_WORDS[s].test(t))
  if (!INTENT.test(t) && !named.length) return null

  const picked = named.length
    ? all.filter((x) => named.includes(x.doctor))
    : services.length
      ? all.filter((x) => services.includes(x.doctor.service))
      : all
  const chosen = picked.length ? picked : all

  // Пожелания по дням: «завтра», «в субботу».
  const today = clinicDate(now)
  const wantDates = new Set<string>()
  if (/сегодня|bugun/.test(t)) wantDates.add(today)
  if (/(?<!после)завтра|ertaga/.test(t)) wantDates.add(addDays(today, 1))
  if (/послезавтра|indinga/.test(t)) wantDates.add(addDays(today, 2))
  const wantDays = new Set(WEEKDAY_WORDS.filter(([, re]) => re.test(t)).map(([d]) => d))
  const wanted = (date: string) => wantDates.has(date) || wantDays.has(weekdayOf(date))
  const maxDays = chosen.length <= 2 ? 7 : chosen.length <= 3 ? 4 : 3

  const tx = TEXT[locale]
  const lines: string[] = [
    `${tx.now}: ${dayName(today, locale)} ${today.slice(0, 4)}, ${clinicTime(now)} (${tx.tz}).`,
    tx.intro,
  ]
  let shown = 0
  for (const { doctor, slots } of chosen) {
    lines.push('', `${tx.doctor}: ${doctor.name[locale]} — ${doctor.specialty[locale]}; ${tx.service}: ${SERVICES[doctor.service][locale]}; ID: ${doctor.id}`)
    if (!slots.length) {
      lines.push(`- ${tx.none}`)
      continue
    }
    const byDate = new Map<string, string[]>()
    for (const s of slots) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s.time])
    const all = [...byDate.keys()]
    const fit = all.filter(wanted)
    // Есть окна в нужные дни — они и пара ближайших для выбора. Нет — просто
    // ближайшие: модель скажет, что в тот день мест нет.
    const dates = fit.length
      ? [...fit.slice(0, 3), ...all.filter((d) => !fit.includes(d)).slice(0, 2)].sort()
      : all.slice(0, maxDays)
    for (const d of dates) {
      lines.push(`- ${dayName(d, locale)} (${d}): ${byDate.get(d)!.join(', ')}`)
      shown += byDate.get(d)!.length
    }
  }

  return {
    info: { text: lines.join('\n'), doctors: chosen.length, slots: shown },
    slots: chosen,
    wanted,
  }
}

/* ---------- Метки [[book:…]] ---------- */

const MARK = /\[\[book:\s*([a-z0-9_-]+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*\]\]/gi
const MARK_START = '[[book:'

export const stripBookMarks = (text: string) => text.replace(MARK, '').replace(/\s+$/, '')

/**
 * Фильтр потока: метки [[book:…]] клиенту не показываем. Всё, что
 * может оказаться началом метки, придерживаем до «]]» или до явного
 * несовпадения.
 */
export function bookMarkFilter(out: (text: string) => void) {
  let held = ''
  const drain = (final: boolean) => {
    for (;;) {
      const i = held.indexOf('[')
      if (i < 0) {
        if (held) out(held)
        held = ''
        return
      }
      if (i > 0) {
        out(held.slice(0, i))
        held = held.slice(i)
      }
      const rest = held.toLowerCase()
      if (rest.startsWith(MARK_START)) {
        const end = held.indexOf(']]')
        if (end < 0) {
          if (final) held = '' // оборванная метка — просто выбрасываем
          return
        }
        held = held.slice(end + 2)
        continue
      }
      if (MARK_START.startsWith(rest) && !final) return // «[», «[[bo» — ждём продолжения
      out(held[0])
      held = held.slice(1)
    }
  }
  return {
    push(text: string) {
      held += text
      drain(false)
    },
    flush() {
      drain(true)
    },
  }
}

const offerOf = (doctor: Doctor, slot: Slot | null, locale: Locale): BookingOffer => ({
  doctorId: doctor.id,
  doctor: doctor.name[locale],
  startsAt: slot?.startsAt ?? null,
  date: slot?.date ?? null,
  time: slot?.time ?? null,
})

/**
 * Кнопки записи под ответом. Берём метки модели, но только те, что
 * совпали с настоящим свободным окном. Меток нет — ближайшее окно
 * врачей, названных в ответе (или единственного подходящего врача).
 */
export function bookingOffers(raw: string, ctx: ScheduleContext, locale: Locale): BookingOffer[] {
  const offers: BookingOffer[] = []
  for (const m of raw.matchAll(MARK)) {
    const [, id, date, time] = m
    const hhmm = time.padStart(5, '0')
    const ds = ctx.slots.find((x) => x.doctor.id === id.toLowerCase())
    const slot = ds?.slots.find((s) => s.date === date && s.time === hhmm)
    if (ds && slot && !offers.some((o) => o.startsAt === slot.startsAt && o.doctorId === ds.doctor.id)) {
      offers.push(offerOf(ds.doctor, slot, locale))
    }
    if (offers.length === 3) break
  }
  if (offers.length) return offers

  const answer = stripBookMarks(raw)
  const named = namedDoctors(answer, ctx.slots.map((x) => x.doctor))
  const doctors = named.length ? named : ctx.slots.length === 1 ? [ctx.slots[0].doctor] : []
  return doctors.slice(0, 3).map((d) => {
    const slots = ctx.slots.find((x) => x.doctor === d)?.slots ?? []
    return offerOf(d, slots.find((s) => ctx.wanted(s.date)) ?? slots[0] ?? null, locale)
  })
}
