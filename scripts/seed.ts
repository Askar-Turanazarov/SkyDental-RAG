import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOCTORS_SLUG, doctorsMarkdown, parseDoctorsXlsx, saveDoctors } from '../server/booking/doctors.js'
import { getDb, migrate } from '../server/db/client.js'
import { officeToMarkdown } from '../server/drive/convert.js'
import type { OfficeKind } from '../server/drive/convert.js'
import { driveEnabled } from '../server/drive/client.js'
import { reindexAll, saveDocument } from '../server/rag/ingest.js'
import { syncFromDrive } from '../server/rag/sync.js'
import type { Locale } from '../shared/protocol.js'

/* ============================================================
   npm run seed — залить content/drive/{ru,uz}/*.docx|xlsx в базу и
   проиндексировать; content/drive/doctors.xlsx — врачи и график для
   записи и из них документ «Врачи». Это те же файлы, что лежат в папке Google Drive
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

async function seedDocument(locale: Locale, slug: string, read: () => Promise<string>) {
  const [exists] = await db.query('select 1 from documents where locale = $1 and slug = $2', [locale, slug])
  if (exists && !force) {
    console.log(`  ${locale}/${slug}: уже в базе, пропускаю (--force, чтобы перезаписать)`)
    return
  }
  const res = await saveDocument({ locale, slug, bodyMd: await read(), note: 'seed из content/drive', index: !noIndex })
  const idx = res.index
  console.log(
    res.changed && !idx
      ? `  ${locale}/${slug}: v${res.version}, записан без индекса`
      : res.changed && idx
      ? `  ${locale}/${slug}: v${res.version}, кусков ${idx.total}, векторов посчитано ${idx.embedded}, взято готовых ${idx.reused}`
      : `  ${locale}/${slug}: без изменений`,
  )
}

for (const locale of ['ru', 'uz'] as Locale[]) {
  const dir = fileURLToPath(new URL(`${locale}/`, root))
  const files = (await readdir(dir)).filter((f) => /\.(docx|xlsx)$/.test(f)).sort()

  for (const file of files) {
    const kind = extname(file).slice(1) as OfficeKind
    const slug = basename(file, extname(file))
    if (slug === DOCTORS_SLUG) continue // документ «Врачи» собирается из doctors.xlsx ниже
    await seedDocument(locale, slug, async () => officeToMarkdown(kind, await readFile(join(dir, file))))
  }
}

// Врачи и график: content/drive/doctors.xlsx → таблица doctors + документ «Врачи».
const doctors = await parseDoctorsXlsx(await readFile(fileURLToPath(new URL('doctors.xlsx', root))))
const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from doctors')
if (n && !force) console.log(`  врачи: уже в базе (${n}), пропускаю (--force, чтобы перезаписать)`)
else {
  await saveDoctors(doctors)
  console.log(`  врачи: ${doctors.length}`)
}
for (const locale of ['ru', 'uz'] as Locale[])
  await seedDocument(locale, DOCTORS_SLUG, async () => doctorsMarkdown(doctors, locale))

if (reindex) {
  const reports = await reindexAll()
  const sum = (k: 'total' | 'embedded' | 'reused') => reports.reduce((s, r) => s + r[k], 0)
  console.log(
    `  переиндексация: документов ${reports.length}, кусков ${sum('total')}, ` +
      `векторов посчитано ${sum('embedded')}, взято готовых ${sum('reused')}`,
  )
}

// Drive подключён — он источник правды: подтянуть из него всё, что новее файлов репозитория.
if (driveEnabled() && !noIndex) {
  const res = await syncFromDrive('seed', true)
  console.log(`  Google Drive: файлов ${res.files}, изменений ${res.changes.length}`)
  for (const e of res.changes) console.log(`    ${e.action} ${e.locale ?? ''}/${e.slug ?? ''} ${e.message ?? ''}`)
}

console.log('Готово.')
process.exit(0)
