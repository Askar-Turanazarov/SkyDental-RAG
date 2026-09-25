import type { Dict, Locale } from '../../i18n/types'
import { ru } from '../../i18n/ru'
import { uz } from '../../i18n/uz'

/* ============================================================
   ВРЕМЕННАЯ база знаний бота-заглушки.

   База собирается из текстов самого сайта (FAQ, услуги, контакты),
   поэтому бот-заглушка отвечает теми же формулировками, что и
   страница, и не может им противоречить. Когда подключится
   настоящий RAG (см. ragClient.ts), этот файл можно удалить.

   Поиск — простое пересечение основ слов (первые 5 букв), этого
   хватает для русских и узбекских словоформ на демо-объёме.
   ============================================================ */

interface Doc {
  /** Текст, по которому ищем. */
  haystack: string
  answer: string
  source: string
  /** Документ про цену услуги — поднимается, если в вопросе есть «сколько/цена». */
  isPrice: boolean
}

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

function buildDocs(t: Dict): Doc[] {
  const docs: Doc[] = []

  for (const item of t.faq.items) {
    docs.push({
      haystack: item.q + ' ' + item.a,
      answer: item.a,
      source: `${t.faq.eyebrow} · ${item.q}`,
      isPrice: false,
    })
  }

  for (const s of t.services.items) {
    docs.push({
      haystack: s.name + ' ' + s.benefit,
      answer: `${s.name} — ${t.services.from} ${s.price} UZS. ${s.benefit} ${t.services.priceNote}`,
      source: `${t.services.eyebrow} · ${s.name}`,
      isPrice: true,
    })
  }

  const c = t.contacts
  docs.push({
    haystack: [c.title, c.lede, c.address, c.hours, t.nav.book].join(' '),
    answer: `${c.lede} ${c.phoneLabel}: ${c.phone}. ${c.hoursLabel}: ${c.hours}. ${c.addressLabel}: ${c.address}.`,
    source: `${c.eyebrow}`,
    isPrice: false,
  })

  return docs
}

interface IndexedDoc extends Doc {
  terms: Set<string>
}

const INDEX: Record<Locale, IndexedDoc[]> = {
  ru: buildDocs(ru).map((d) => ({ ...d, terms: new Set(stems(d.haystack)) })),
  uz: buildDocs(uz).map((d) => ({ ...d, terms: new Set(stems(d.haystack)) })),
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
