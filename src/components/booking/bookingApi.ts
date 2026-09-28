import type { BookingRequest, BookingResponse, Doctor, Slot, SlotsResponse } from '../../../shared/booking'

/* ============================================================
   Клиент API записи (server/booking/routes.ts).

   Адрес — рядом с API чата: VITE_RAG_ENDPOINT=/api/chat → /api/booking.
   Без него сайт работает как демо без бэкенда, и вместо формы
   записи показывается ссылка на Telegram.
   ============================================================ */

const chat = import.meta.env.VITE_RAG_ENDPOINT?.trim()
export const bookingApi = chat ? chat.replace(/chat\/?$/, 'booking') : null

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${bookingApi}${path}`)
  if (!res.ok) throw new Error(`booking API ${res.status}`)
  return (await res.json()) as T
}

export const fetchDoctors = async () => (await getJson<{ doctors: Doctor[] }>('/doctors')).doctors

export const fetchSlots = async (doctorId: string): Promise<Slot[]> =>
  (await getJson<SlotsResponse>(`/slots?doctor=${encodeURIComponent(doctorId)}`)).slots

/** Ответы 4xx — понятные ошибки записи ({ error }), 5xx и сеть — исключение. */
export async function book(req: BookingRequest): Promise<BookingResponse> {
  const res = await fetch(bookingApi!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (res.status >= 500) throw new Error(`booking API ${res.status}`)
  return (await res.json()) as BookingResponse
}

/* ---------- «Записаться на это время» из чата ---------- */

const BOOK_EVENT = 'skydental:book'

export interface BookPrefill {
  doctorId: string
  startsAt?: string
}

/** Открыть форму записи с выбранным врачом и окном. */
export function openBooking(prefill: BookPrefill) {
  window.dispatchEvent(new CustomEvent<BookPrefill>(BOOK_EVENT, { detail: prefill }))
  document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function onOpenBooking(handler: (p: BookPrefill) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<BookPrefill>).detail)
  window.addEventListener(BOOK_EVENT, listener)
  return () => window.removeEventListener(BOOK_EVENT, listener)
}
