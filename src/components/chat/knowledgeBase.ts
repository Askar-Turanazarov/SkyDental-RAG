import type { Locale } from '../../i18n/types'

import ruPrices from '../../../content/rag/ru/prices.md?raw'
import ruFaq from '../../../content/rag/ru/faq.md?raw'
import ruSchedule from '../../../content/rag/ru/schedule.md?raw'
import uzPrices from '../../../content/rag/uz/prices.md?raw'
import uzFaq from '../../../content/rag/uz/faq.md?raw'
import uzSchedule from '../../../content/rag/uz/schedule.md?raw'

/* ============================================================
   База знаний клиники.

   Источник правды — markdown в `content/rag/`. Те же самые файлы
   уйдут в настоящий RAG-пайплайн, когда он появится: они написаны
   для человека, их может править администратор клиники, и копии в
   TypeScript специально не заводим, чтобы данные не разъехались.

   Здесь markdown только режется на куски. Это не «свой парсер
   markdown» — нам нужны ровно две структуры: раздел `##` и строка
   таблицы. Остальной синтаксис остаётся в тексте как есть, потому
   что бот показывает ответ обычным абзацем.
   ============================================================ */

export interface KnowledgeDoc {
  /** Текст, по которому ищем. */
  haystack: string
  answer: string
  source: string
  /** Документ про цену: поднимается, если в вопросе есть «сколько/цена». */
  isPrice: boolean
}

interface SourceFile {
  text: string
  /** Роль документа, а не его содержимое, поэтому задана здесь. */
  isPrice: boolean
}

const FILES: Record<Locale, SourceFile[]> = {
  ru: [
    { text: ruPrices, isPrice: true },
    { text: ruFaq, isPrice: false },
    { text: ruSchedule, isPrice: false },
  ],
  uz: [
    { text: uzPrices, isPrice: true },
    { text: uzFaq, isPrice: false },
    { text: uzSchedule, isPrice: false },
  ],
}

/** `| a | b | c |` → `['a', 'b', 'c']`. */
function cells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim())
}

/** Строка-разделитель шапки таблицы: `| --- | --- |`. */
function isDivider(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line)
}

/**
 * Строка таблицы → связное предложение.
 *
 * Первая ячейка — название позиции, остальные дописываются к нему
 * через точку. Для прайса это даёт «Имплантация — от 6 500 000 сум.
 * Имплант, операция…», то есть ровно то, что человек и спрашивает.
 */
function rowToSentence(row: string[]): string {
  const [name, ...rest] = row
  const tail = rest.filter(Boolean).join('. ')
  if (!tail) return name
  return `${name} — ${tail}${/[.!?]$/.test(tail) ? '' : '.'}`
}

function parseDocument({ text, isPrice }: SourceFile): KnowledgeDoc[] {
  const docs: KnowledgeDoc[] = []
  const lines = text.split('\n')

  let title = ''
  let heading = ''
  let prose: string[] = []
  let tableHead: string[] | null = null

  const flushProse = () => {
    const answer = prose.join(' ').replace(/\s+/g, ' ').trim()
    prose = []
    if (!answer) return
    // Раздел без заголовка — это вступление документа, и подписью
    // ему служит сам заголовок документа.
    const source = heading ? `${title} · ${heading}` : title
    docs.push({ haystack: `${title} ${heading} ${answer}`, answer, source, isPrice })
  }

  for (const raw of lines) {
    const line = raw.trim()

    if (line.startsWith('# ')) {
      title = line.slice(2).trim()
      continue
    }

    if (line.startsWith('## ')) {
      flushProse()
      tableHead = null
      heading = line.slice(3).trim()
      continue
    }

    if (line.startsWith('|')) {
      if (isDivider(line)) continue
      const row = cells(line)
      // Первая строка таблицы — шапка: она не ответ, но её слова
      // помогают найти строки («услуга», «цена»).
      if (!tableHead) {
        tableHead = row
        continue
      }
      const answer = rowToSentence(row)
      docs.push({
        haystack: `${title} ${heading} ${tableHead.join(' ')} ${row.join(' ')}`,
        answer,
        source: `${title} · ${row[0]}`,
        isPrice,
      })
      continue
    }

    // Пустая строка внутри раздела не разрывает его: абзацы одного
    // раздела — это один ответ.
    if (!line) continue
    if (/^[-*]\s+/.test(line)) {
      // Пункт списка в сплошном ответе нужно закрыть точкой, иначе
      // «Понедельник 09:00–20:00 Вторник 09:00–20:00» слипнется.
      const item = line.replace(/^[-*]\s+/, '')
      prose.push(/[.!?]$/.test(item) ? item : `${item}.`)
      continue
    }
    prose.push(line)
  }

  flushProse()
  return docs
}

export const KNOWLEDGE: Record<Locale, KnowledgeDoc[]> = {
  ru: FILES.ru.flatMap(parseDocument),
  uz: FILES.uz.flatMap(parseDocument),
}
