import { handle } from 'hono/vercel'
import app from '../server/app.js'

/* Точка входа Vercel. Все запросы /api/* сюда направляет rewrite
   в vercel.json, а дальше маршрутизирует Hono (server/app.ts). */

const handler = handle(app)

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
