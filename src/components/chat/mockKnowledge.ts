import type { Locale } from '../../i18n/types'
import { queryTerms, stems } from '../../../shared/text.js'
import { KNOWLEDGE } from './knowledgeBase'
import type { KnowledgeDoc } from './knowledgeBase'

/* ============================================================
   ПОИСК демо-бота по базе знаний — только ключевые слова.

   Основы слов (первые 5 букв, shared/text.ts) — та же логика, что
   у ключевого плеча гибридного поиска на сервере. Векторного плеча
   здесь нет: для него нужна модель эмбеддингов, то есть бэкенд.
   Поэтому демо не понимает синонимов и другой язык — сравните с
   настоящим RAG в панели «Как я нашёл ответ».
   ============================================================ */

interface IndexedDoc extends KnowledgeDoc {
  terms: Set<string>
  /** Основы подписи источника: «Прайс-лист · Имплантация одного зуба». */
  labelTerms: Set<string>
}

const index = (d: KnowledgeDoc): IndexedDoc => ({
  ...d,
  terms: new Set(stems(d.searchText)),
  labelTerms: new Set(stems(d.sourceLabel)),
})

const INDEX: Record<Locale, IndexedDoc[]> = {
  ru: KNOWLEDGE.ru.map(index),
  uz: KNOWLEDGE.uz.map(index),
}

export interface MockHit {
  doc: KnowledgeDoc
  /** Сколько основ вопроса нашлось в куске. */
  hits: number
  /** Доля основ вопроса, найденных в куске, 0…1. */
  score: number
  rank: number
}

/** Лучшие куски по совпадению основ, в порядке убывания. */
export function searchMockKnowledge(question: string, locale: Locale, limit = 8): { hits: MockHit[]; terms: string[] } {
  const { terms, priceIntent } = queryTerms(question)
  if (terms.length === 0) return { hits: [], terms }

  const scored = INDEX[locale]
    .map((doc) => {
      const hits = terms.filter((w) => doc.terms.has(w)).length
      // Слово вопроса в заголовке куска — сильный сигнал: «имплант» в строке
      // «Имплантация одного зуба» важнее, чем в строке про томографию,
      // где имплантация лишь упомянута.
      const labelHits = terms.filter((w) => doc.labelTerms.has(w)).length
      return { doc, hits, sort: hits + labelHits * 0.25 + (priceIntent && doc.isPrice ? 0.5 : 0) }
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.sort - a.sort)
    .slice(0, limit)

  return {
    terms,
    hits: scored.map((s, i) => ({ doc: s.doc, hits: s.hits, score: s.hits / terms.length, rank: i + 1 })),
  }
}
