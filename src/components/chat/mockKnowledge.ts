import type { Locale } from '../../i18n/types'
import { KNOWLEDGE } from './knowledgeBase'
import type { KnowledgeDoc } from './knowledgeBase'

/* ============================================================
   ПОИСК бота-заглушки по базе знаний клиники.

   Сами документы живут в `content/rag/` и разбираются в
   knowledgeBase.ts — здесь только поиск. Раньше база собиралась из
   текстов самой страницы, и бот не мог сказать ничего сверх того,
   что и так написано на сайте; теперь он отвечает по прайсу, FAQ и
   графику работы.

   Поиск — простое пересечение основ слов (первые 5 букв), этого
   хватает для русских и узбекских словоформ на демо-объёме. Когда
   подключится настоящий RAG (см. ragClient.ts), этот файл можно
   удалить, а документы останутся: их и получит бэкенд.
   ============================================================ */

type Doc = KnowledgeDoc

/** Слова вопроса, которые ничего не говорят о теме. */
const STOPWORDS = new Set([
  // ru
  'сколь', 'стоит', 'можно', 'какой', 'какая', 'какие', 'как', 'ли', 'вы', 'у', 'вас',
  'есть', 'нужно', 'надо', 'это', 'что', 'где', 'когда', 'правд', 'мне', 'для', 'при',
  // uz
  'qanch', 'turad', 'mumki', 'qanda', 'nima', 'bormi', 'kerak', 'uchun', 'bilan', 'rostd',
])

const PRICE_WORDS = new Set(['сколь', 'стоит', 'цена', 'цены', 'стоим', 'прайс', 'qanch', 'turad', 'narx', 'narxi'])

function stems(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}ʻʼ']+/gu) ?? [])
    .map((w) => w.replace(/[ʻʼ']/g, ''))
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, 5))
}

interface IndexedDoc extends Doc {
  terms: Set<string>
}

const INDEX: Record<Locale, IndexedDoc[]> = {
  ru: KNOWLEDGE.ru.map((d) => ({ ...d, terms: new Set(stems(d.haystack)) })),
  uz: KNOWLEDGE.uz.map((d) => ({ ...d, terms: new Set(stems(d.haystack)) })),
}

export function searchMockKnowledge(question: string, locale: Locale): Doc | null {
  const all = stems(question)
  const priceIntent = all.some((w) => PRICE_WORDS.has(w))
  const terms = all.filter((w) => !STOPWORDS.has(w))
  if (terms.length === 0) return null

  let best: IndexedDoc | null = null
  let bestScore = 0

  for (const doc of INDEX[locale]) {
    const hits = terms.filter((w) => doc.terms.has(w)).length
    if (hits === 0) continue
    const score = hits + (priceIntent && doc.isPrice ? 0.5 : 0)
    if (score > bestScore) {
      best = doc
      bestScore = score
    }
  }

  return best
}
