import { serve } from '@hono/node-server'
import app from './app.js'
import { getDb } from './db/client.js'
import { env } from './env.js'
import { chain, providers } from './llm/registry.js'

/* Локальный API-сервер. Vite проксирует на него /api (vite.config.ts). */

const db = await getDb()
serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`API: http://localhost:${port}/api/health`)
  console.log(`  база:        ${db.driver === 'pglite' ? 'PGlite (.data/pglite)' : 'Postgres (DATABASE_URL)'}`)
  console.log(`  провайдеры:  ${[...providers.keys()].join(', ')}`)
  console.log(`  цепочка:     ${chain.map((e) => `${e.provider}:${e.model}`).join(' → ')}`)
  console.log(`  эмбеддинги:  ${env.EMBED_PROVIDER}:${env.EMBED_MODEL}`)
})
