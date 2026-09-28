import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { parse } from 'node-html-parser'
import type { HTMLElement } from 'node-html-parser'

/* ============================================================
   Word и Excel → markdown базы знаний.

   Дальше по конвейеру идёт тот же markdown, что и раньше:
   shared/chunker.ts режет его на фрагменты, ingest.ts считает
   векторы. Поэтому здесь нужны ровно те структуры, которые
   понимает нарезка:

   Word (.docx):
     Заголовок 1 → `# Название документа`
     Заголовок 2 → `## Раздел` (один раздел — один фрагмент)
     абзацы, списки, таблицы (строка таблицы — отдельный фрагмент)

   Excel (.xlsx) — для графика работы. Первый лист, название листа —
   название документа, колонки: Раздел | Пункт | Значение.
     Пункт и Значение  → `- Пункт — Значение`
     только Пункт      → `- Пункт`
     только Значение   → абзац
   Строки с одним «Разделом» собираются в один `## Раздел`: так все
   дни недели остаются одним фрагментом «Часы работы», а не семью.
   ============================================================ */

export type OfficeKind = 'docx' | 'xlsx'

export function officeToMarkdown(kind: OfficeKind, data: Buffer): Promise<string> {
  return kind === 'docx' ? docxToMarkdown(data) : xlsxToMarkdown(data)
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
/** `|` внутри ячейки сломал бы строку таблицы markdown. */
const cell = (s: string) => clean(s).replace(/\|/g, '/')

export async function docxToMarkdown(data: Buffer): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer: data })
  const blocks: string[] = []

  for (const node of parse(html).childNodes) {
    const el = node as HTMLElement
    const tag = el.tagName?.toLowerCase()
    if (!tag) continue
    const text = clean(el.text)

    if (tag === 'h1') {
      if (text) blocks.push(`# ${text}`)
    } else if (/^h[2-6]$/.test(tag)) {
      if (text) blocks.push(`## ${text}`)
    } else if (tag === 'ul' || tag === 'ol') {
      const items = el.querySelectorAll('li').map((li) => clean(li.text)).filter(Boolean)
      if (items.length) blocks.push(items.map((i) => `- ${i}`).join('\n'))
    } else if (tag === 'table') {
      const rows = el
        .querySelectorAll('tr')
        .map((tr) => tr.querySelectorAll('td, th').map((td) => cell(td.text)))
        .filter((r) => r.some(Boolean))
      if (!rows.length) continue
      const width = Math.max(...rows.map((r) => r.length))
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`
      blocks.push([line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n'))
    } else if (text) {
      blocks.push(text)
    }
  }

  return `${blocks.join('\n\n')}\n`
}

export async function xlsxToMarkdown(data: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data as unknown as ArrayBuffer)
  const sheet = wb.worksheets[0]
  if (!sheet) return ''

  const sections: { heading: string; lines: string[] }[] = []
  sheet.eachRow((row, n) => {
    if (n === 1) return // шапка: Раздел | Пункт | Значение
    const [heading, item, value] = [1, 2, 3].map((i) => clean(row.getCell(i).text ?? ''))
    if (!item && !value) return
    let section = sections.at(-1)
    if (!section || section.heading !== heading) sections.push((section = { heading, lines: [] }))
    section.lines.push(item && value ? `- ${item} — ${value}` : item ? `- ${item}` : value)
  })

  const blocks = [`# ${clean(sheet.name)}`]
  for (const s of sections) {
    if (s.heading) blocks.push(`## ${s.heading}`)
    // Пункты списка идут подряд, абзацы отделяются пустой строкой.
    let prev = ''
    for (const l of s.lines) {
      const isItem = l.startsWith('- ')
      if (isItem && prev.startsWith('- ')) blocks[blocks.length - 1] += `\n${l}`
      else blocks.push(l)
      prev = l
    }
  }
  return `${blocks.join('\n\n')}\n`
}
