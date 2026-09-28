import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb, migrate } from '../server/db/client.js'
import { officeToMarkdown } from '../server/drive/convert.js'
import type { OfficeKind } from '../server/drive/convert.js'
import { reindexAll, saveDocument } from '../server/rag/ingest.js'
import type { Locale } from '../shared/protocol.js'

/* ============================================================
   npm run seed — залить content/drive/{ru,uz}/*.docx|xlsx в базу и
   проиндексировать. Это те же файлы, что лежат в папке Google Drive
   (npm run export:office), и читаются они тем же конвертером —
   seed нужен, когда Drive не подключён или база пустая.

   По умолчанию документы, которые уже есть в базе, НЕ трогаются:
   их могла обновить синхронизация с Drive, а файлы в репозитории —
   только начальные данные. Флаг --force перезаписывает их содержимым файлов
   (как новая версия, старые остаются в истории).

   --reindex — пересчитать индекс всех документов базы, например
   после смены EMBED_MODEL. Тексты не трогает; векторы считаются
   заново только там, где их посчитала другая модель. То же, что
   «Переиндексировать всё» в админке.

   --no-index — только записать тексты, без эмбеддингов. Для Vercel,
   где ключ модели хранится как секрет и локально недоступен: индекс
   потом строит «Переиндексировать всё» в админке на самом Vercel.
   ============================================================ */

const force = process.argv.includes('--force')
const reindex = process.argv.includes('--reindex')
const noIndex = process.argv.includes('--no-index')
const root = new URL('../content/drive/', import.meta.url)

await migrate()
const db = await getDb()

for (const locale of ['ru', 'uz'] as Locale[]) {
  const dir = fileURLToPath(new URL(`${locale}/`, root))
  const files = (await readdir(dir)).filter((f) => /\.(docx|xlsx)$/.test(f)).sort()

  for (const file of files) {
    const kind = extname(file).slice(1) as OfficeKind
    const slug = basename(file, extname(file))
    const [exists] = await db.query('select 1 from documents where locale = $1 and slug = $2', [locale, slug])
    if (exists && !force) {
      console.log(`  ${locale}/${slug}: уже в базе, пропускаю (--force, чтобы перезаписать)`)
      continue
    }
    const bodyMd = await officeToMarkdown(kind, await readFile(join(dir, file)))
    const res = await saveDocument({ locale, slug, bodyMd, note: 'seed из content/drive', index: !noIndex })
    const idx = res.index
    console.log(
      res.changed && !idx
        ? `  ${locale}/${slug}: v${res.version}, записан без индекса`
        : res.changed && idx
        ? `  ${locale}/${slug}: v${res.version}, кусков ${idx.total}, векторов посчитано ${idx.embedded}, взято готовых ${idx.reused}`
        : `  ${locale}/${slug}: без изменений`,
    )
  }
}

if (reindex) {
  const reports = await reindexAll()
  const sum = (k: 'total' | 'embedded' | 'reused') => reports.reduce((s, r) => s + r[k], 0)
  console.log(
    `  переиндексация: документов ${reports.length}, кусков ${sum('total')}, ` +
      `векторов посчитано ${sum('embedded')}, взято готовых ${sum('reused')}`,
  )
}

console.log('Готово.')
process.exit(0)
