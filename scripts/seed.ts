import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb, migrate } from '../server/db/client.js'
import { saveDocument } from '../server/rag/ingest.js'
import type { Locale } from '../shared/protocol.js'

/* ============================================================
   npm run seed — залить content/rag/{ru,uz}/*.md в базу и
   проиндексировать.

   По умолчанию документы, которые уже есть в базе, НЕ трогаются:
   их могли поправить в админке, а md-файлы — только начальные
   данные. Флаг --force перезаписывает их содержимым файлов
   (как новая версия, старые остаются в истории).
   ============================================================ */

const force = process.argv.includes('--force')
const root = new URL('../content/rag/', import.meta.url)

await migrate()
const db = await getDb()

for (const locale of ['ru', 'uz'] as Locale[]) {
  const dir = fileURLToPath(new URL(`${locale}/`, root))
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()

  for (const file of files) {
    const slug = basename(file, '.md')
    const [exists] = await db.query('select 1 from documents where locale = $1 and slug = $2', [locale, slug])
    if (exists && !force) {
      console.log(`  ${locale}/${slug}: уже в базе, пропускаю (--force, чтобы перезаписать)`)
      continue
    }
    const bodyMd = (await readFile(join(dir, file), 'utf8')).replace(/\r\n/g, '\n')
    const res = await saveDocument({ locale, slug, bodyMd, note: 'seed из content/rag' })
    const idx = res.index
    console.log(
      res.changed && idx
        ? `  ${locale}/${slug}: v${res.version}, кусков ${idx.total}, векторов посчитано ${idx.embedded}, взято готовых ${idx.reused}`
        : `  ${locale}/${slug}: без изменений`,
    )
  }
}

console.log('Готово.')
process.exit(0)
