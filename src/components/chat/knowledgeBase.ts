import type { Locale } from '../../i18n/types'
import { chunkMarkdown } from '../../../shared/chunker.js'
import type { Chunk } from '../../../shared/chunker.js'

import ruPrices from '../../../content/rag/ru/prices.md?raw'
import ruFaq from '../../../content/rag/ru/faq.md?raw'
import ruSchedule from '../../../content/rag/ru/schedule.md?raw'
import uzPrices from '../../../content/rag/uz/prices.md?raw'
import uzFaq from '../../../content/rag/uz/faq.md?raw'
import uzSchedule from '../../../content/rag/uz/schedule.md?raw'

/* ============================================================
   База знаний демо-режима (без бэкенда).

   Те же markdown из `content/rag/`, что уходят в базу через
   `npm run seed`, и та же нарезка (shared/chunker.ts), что на
   сервере. Поэтому куски в демо и на сервере совпадают — разница
   только в поиске: здесь по словам, там гибрид «вектор + слова».
   ============================================================ */

export interface KnowledgeDoc extends Chunk {
  locale: Locale
  /** Кусок прайса: поднимается, если в вопросе есть «сколько/цена». */
  isPrice: boolean
}

const FILES: Record<Locale, { text: string; isPrice: boolean }[]> = {
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

function build(locale: Locale): KnowledgeDoc[] {
  return FILES[locale].flatMap(({ text, isPrice }) =>
    chunkMarkdown(text.replace(/\r\n/g, '\n')).map((c) => ({ ...c, locale, isPrice })),
  )
}

export const KNOWLEDGE: Record<Locale, KnowledgeDoc[]> = {
  ru: build('ru'),
  uz: build('uz'),
}
