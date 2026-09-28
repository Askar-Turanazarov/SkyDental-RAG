import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { BookingError, BookingResponse, SlotsResponse } from '../../shared/booking.js'
import { clientIp, hashIp, overLimit } from '../rateLimit.js'
import { BookingFailure, createAppointment, freeSlots } from './appointments.js'
import { listDoctors } from './doctors.js'
import { pushToSheetSoon } from './sheet.js'

/* ============================================================
   /api/booking — публичный API записи на приём.

   GET  /doctors           — действующие врачи с графиком
   GET  /slots?doctor=<id> — свободные окна врача на две недели
   POST /                  — записаться; 409, если окно уже заняли
   ============================================================ */

const booking = new Hono()

/** Записаться можно не чаще стольких раз в час с одного IP. */
const BOOKINGS_PER_HOUR = 5

const STATUS: Record<BookingError, ContentfulStatusCode> = {
  'bad-request': 400,
  'bad-phone': 400,
  'bad-name': 400,
  'doctor-not-found': 404,
  'slot-invalid': 409,
  taken: 409,
  'too-many': 409,
  'rate-limit': 429,
}

const fail = (code: BookingError) => ({ body: { error: code } satisfies BookingResponse, status: STATUS[code] })

booking.get('/doctors', async (c) => {
  c.header('cache-control', 'no-store')
  return c.json({ doctors: await listDoctors() })
})

booking.get('/slots', async (c) => {
  const doctorId = c.req.query('doctor') ?? ''
  const [found] = await freeSlots({ doctorIds: [doctorId] })
  if (!found) {
    const { body, status } = fail('doctor-not-found')
    return c.json(body, status)
  }
  c.header('cache-control', 'no-store')
  return c.json({ doctorId, slots: found.slots } satisfies SlotsResponse)
})

const bookingSchema = z.object({
  doctorId: z.string().trim().min(1).max(40),
  startsAt: z.string().max(40),
  name: z.string().max(200),
  phone: z.string().max(40),
  comment: z.string().max(500).optional(),
  locale: z.enum(['ru', 'uz']),
  source: z.enum(['site', 'chat']).default('site'),
  website: z.string().max(200).optional(),
})

booking.post('/', async (c) => {
  const parsed = bookingSchema.safeParse(await c.req.json().catch(() => null))
  // Скрытое поле website заполняют только боты.
  if (!parsed.success || parsed.data.website) {
    const { body, status } = fail('bad-request')
    return c.json(body, status)
  }

  const ipHash = hashIp(clientIp(c.req.raw.headers))
  try {
    if (await overLimit(`booking:${ipHash}`, BOOKINGS_PER_HOUR, 3600)) {
      const { body, status } = fail('rate-limit')
      return c.json(body, status)
    }
  } catch (err) {
    console.error('[rate-limit]', err)
  }

  try {
    const appointment = await createAppointment({ ...parsed.data, ipHash })
    // Копия в Google Таблицу. Сбой или задержка Google не отменяют запись:
    // строка уйдёт со следующей попыткой.
    await pushToSheetSoon()
    return c.json({ appointment } satisfies BookingResponse, 201)
  } catch (err) {
    if (!(err instanceof BookingFailure)) throw err
    const { body, status } = fail(err.code)
    return c.json(body, status)
  }
})

export default booking
