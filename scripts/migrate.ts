import { getDb, migrate } from '../server/db/client.js'

/* npm run db:migrate — применить server/db/schema.sql к базе из DATABASE_URL. */

await migrate()
const db = await getDb()
console.log(`Схема применена (${db.driver}).`)
process.exit(0)
