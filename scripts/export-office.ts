import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import ExcelJS from 'exceljs'
import { DOCTORS_SLUG, doctorsToXlsx, listDoctors, parseDoctorsXlsx } from '../server/booking/doctors.js'
import { getDb } from '../server/db/client.js'
import { officeToMarkdown } from '../server/drive/convert.js'
import type { OfficeKind } from '../server/drive/convert.js'
import { chunkMarkdown } from '../shared/chunker.js'

/* ============================================================
   npm run export:office — текущие документы базы → Word и Excel.

   Берёт тексты из таблицы documents (там могут быть правки из
   админки, более свежие, чем content/rag/*.md) и пишет
   content/drive/{ru,uz}/<slug>.docx, а график — schedule.xlsx.
   Врачи из таблицы doctors — content/drive/doctors.xlsx.
   Эти файлы загружаются в папку Google Drive.

   В конце каждый файл читается обратно тем же конвертером, что и
   на сервере, и нарезка сравнивается с исходной: если фрагменты
   не совпали, значит конвертер что-то теряет — скрипт это скажет.
   ============================================================ */

const SHEET_SLUGS = new Set(['schedule'])
const root = new URL('../content/drive/', import.meta.url)

/* ---------- markdown → блоки ---------- */

type Block =
  | { type: 'h1'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; rows: string[][] }

function blocks(md: string): Block[] {
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ type: 'p', text: para.join(' ') })
    para = []
  }
  for (const raw of md.split('\n')) {
    const line = raw.trim()
    const last = out.at(-1)
    if (!line) flush()
    else if (line.startsWith('# ')) (flush(), out.push({ type: 'h1', text: line.slice(2).trim() }))
    else if (line.startsWith('## ')) (flush(), out.push({ type: 'h2', text: line.slice(3).trim() }))
    else if (/^[-*]\s+/.test(line)) {
      flush()
      const item = line.replace(/^[-*]\s+/, '')
      if (last?.type === 'list') last.items.push(item)
      else out.push({ type: 'list', items: [item] })
    } else if (line.startsWith('|')) {
      flush()
      if (/^\|[\s:|-]+\|$/.test(line)) continue
      const row = line.split('|').slice(1, -1).map((c) => c.trim())
      if (last?.type === 'table') last.rows.push(row)
      else out.push({ type: 'table', rows: [row] })
    } else para.push(line)
  }
  flush()
  return out
}

/* ---------- Word ---------- */

function toDocx(md: string): Promise<Buffer> {
  const children: (Paragraph | Table)[] = []
  for (const b of blocks(md)) {
    if (b.type === 'h1') children.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_1 }))
    else if (b.type === 'h2') children.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_2 }))
    else if (b.type === 'p') children.push(new Paragraph({ text: b.text, spacing: { after: 160 } }))
    else if (b.type === 'list') b.items.forEach((text) => children.push(new Paragraph({ text, bullet: { level: 0 } })))
    else {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: b.rows.map(
            (row, i) =>
              new TableRow({
                tableHeader: i === 0,
                children: row.map(
                  (text) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: i === 0 })] })] }),
                ),
              }),
          ),
        }),
      )
      children.push(new Paragraph({ text: '' }))
    }
  }
  return Packer.toBuffer(new Document({ sections: [{ children }] }))
}

/* ---------- Excel: Раздел | Пункт | Значение ---------- */

async function toXlsx(md: string): Promise<Buffer> {
  const bs = blocks(md)
  const h1 = bs.find((b) => b.type === 'h1')
  const title = h1?.type === 'h1' ? h1.text : 'Документ'
  const wb = new ExcelJS.Workbook()
  // Имя листа — название документа; Excel не допускает в нём []:*?/\ и больше 31 символа.
  const ws = wb.addWorksheet(title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31))
  ws.columns = [
    { header: 'Раздел', width: 30 },
    { header: 'Пункт', width: 26 },
    { header: 'Значение', width: 80 },
  ]
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  let heading = ''
  for (const b of bs) {
    if (b.type === 'h2') heading = b.text
    else if (b.type === 'p') ws.addRow([heading, '', b.text])
    else if (b.type === 'list')
      for (const item of b.items) {
        const [name, ...rest] = item.split(' — ')
        ws.addRow(rest.length ? [heading, name, rest.join(' — ')] : [heading, item, ''])
      }
  }
  ws.getColumn(3).alignment = { wrapText: true, vertical: 'top' }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/* ---------- экспорт + сверка ---------- */

const db = await getDb()
// Документ «Врачи» не выгружается: его собирает сервер из doctors.xlsx.
const docs = await db.query<{ locale: string; slug: string; body_md: string }>(
  'select locale, slug, body_md from documents where slug <> $1 order by locale, slug',
  [DOCTORS_SLUG],
)

let problems = 0
for (const d of docs) {
  const kind: OfficeKind = SHEET_SLUGS.has(d.slug) ? 'xlsx' : 'docx'
  const data = kind === 'xlsx' ? await toXlsx(d.body_md) : await toDocx(d.body_md)
  const dir = new URL(`${d.locale}/`, root)
  await mkdir(fileURLToPath(dir), { recursive: true })
  await writeFile(fileURLToPath(new URL(`${d.slug}.${kind}`, dir)), data)

  const key = (md: string) => chunkMarkdown(md).map((c) => `${c.sourceLabel}\n${c.text}`)
  const before = key(d.body_md)
  const after = key(await officeToMarkdown(kind, data))
  const lost = before.filter((c) => !after.includes(c)).length
  problems += lost
  console.log(`  ${d.locale}/${d.slug}.${kind}: фрагментов ${after.length}${lost ? `, расходятся: ${lost} из ${before.length}` : ', совпадают'}`)
}

// Врачи и график → doctors.xlsx в корне; обратное чтение должно дать тот же список.
const doctors = await listDoctors()
if (doctors.length) {
  const data = await doctorsToXlsx(doctors)
  await writeFile(fileURLToPath(new URL('doctors.xlsx', root)), data)
  const same = JSON.stringify(await parseDoctorsXlsx(data)) === JSON.stringify(doctors)
  if (!same) problems++
  console.log(`  doctors.xlsx: врачей ${doctors.length}${same ? ', читается обратно без потерь' : ', при обратном чтении расходится'}`)
}

console.log(problems ? `Есть расхождения: ${problems}` : 'Готово: нарезка совпадает с базой.')
process.exit(problems ? 1 : 0)
