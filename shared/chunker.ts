/* ============================================================
   НАРЕЗКА markdown базы знаний на куски (chunks).

   Один модуль на всех: его используют демо-бот во фронтенде,
   индексация на сервере и живое превью в админке. Поэтому кусок,
   который видит студент в панели «Как я нашёл ответ», — ровно тот,
   что лежит в векторном индексе.

   Это не «свой парсер markdown»: нужны ровно две структуры.
   - `## Раздел` — один раздел становится одним куском;
   - строка таблицы — отдельный кусок. Для прайса это важно: иначе
     все позиции слиплись бы в один кусок, и поиск по «имплант»
     вытаскивал бы весь прайс целиком.
   `# Заголовок` — название документа, идёт в подпись источника.
   ============================================================ */

export interface Chunk {
  /** Порядковый номер куска в документе. */
  ord: number
  /** Заголовок документа (`# …`). */
  title: string
  /** Раздел (`## …`) или пусто для вступления. */
  heading: string
  /** Подпись источника: «Прайс-лист · Имплантация». */
  sourceLabel: string
  /** Текст куска — то, что уходит в промпт и показывается как цитата. */
  text: string
  /** Текст для поиска: заголовки + шапка таблицы + текст. */
  searchText: string
  kind: 'prose' | 'row'
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

export function chunkMarkdown(markdown: string): Chunk[] {
  const chunks: Chunk[] = []
  const lines = markdown.split('\n')

  let title = ''
  let heading = ''
  let prose: string[] = []
  let tableHead: string[] | null = null

  const push = (c: Omit<Chunk, 'ord'>) => chunks.push({ ...c, ord: chunks.length })

  const flushProse = () => {
    const text = prose.join(' ').replace(/\s+/g, ' ').trim()
    prose = []
    if (!text) return
    // Раздел без заголовка — это вступление документа, и подписью
    // ему служит сам заголовок документа.
    push({
      title,
      heading,
      sourceLabel: heading ? `${title} · ${heading}` : title,
      text,
      searchText: `${title} ${heading} ${text}`,
      kind: 'prose',
    })
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
      push({
        title,
        heading,
        sourceLabel: `${title} · ${row[0]}`,
        text: rowToSentence(row),
        searchText: `${title} ${heading} ${tableHead.join(' ')} ${row.join(' ')}`,
        kind: 'row',
      })
      continue
    }

    // Пустая строка внутри раздела не разрывает его: абзацы одного
    // раздела — это один кусок.
    if (!line) continue
    if (/^[-*]\s+/.test(line)) {
      // Пункт списка в сплошном тексте нужно закрыть точкой, иначе
      // «Понедельник 09:00–20:00 Вторник 09:00–20:00» слипнется.
      const item = line.replace(/^[-*]\s+/, '')
      prose.push(/[.!?]$/.test(item) ? item : `${item}.`)
      continue
    }
    prose.push(line)
  }

  flushProse()
  return chunks
}

/** Заголовок документа — первая строка `# …`. */
export function documentTitle(markdown: string): string {
  const m = markdown.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : ''
}
