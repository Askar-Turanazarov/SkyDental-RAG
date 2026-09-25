import type { Locale, RetrievedChunk } from '../../shared/protocol.js'
import { queryTerms } from '../../shared/text.js'
import { getDb, toVectorLiteral } from '../db/client.js'
import { env } from '../env.js'
import { embedModelLabel, embedProvider } from '../llm/registry.js'

/* ============================================================
   ПОИСК (retrieval): гибрид «по смыслу» + «по словам».

   Плечо 1 — вектор. Вопрос превращается в вектор той же моделью,
   что и куски, и pgvector находит ближайшие по косинусу. Ловит
   смысл: «болит зуб ночью» найдёт «острая боль» без общих слов.
   Работает между языками: узбекский вопрос находит русский кусок.

   Плечо 2 — ключевые слова. Основы слов вопроса (shared/text.ts)
   ищутся полнотекстовым индексом Postgres. Ловит точные названия:
   «Air Flow», «томография», номера и цены.

   Слияние — Reciprocal Rank Fusion: у каждого куска
     rrf = 1/(60 + ранг в векторе) + 1/(60 + ранг в словах).
   Складываются места, а не «сырые» оценки: у двух плеч разные
   шкалы, и сравнивать их напрямую нельзя.
   ============================================================ */

const LEG_LIMIT = 20
const RRF_K = 60
/** Сколько кандидатов показать в трассе (в промпт идут первые RAG_TOP_K). */
const SHOW_LIMIT = 8

interface Row {
  id: number
  locale: Locale
  ord: number
  slug: string
  is_price: boolean
  source_label: string
  text: string
  score: number
}

export interface RetrieveResult {
  chunks: RetrievedChunk[]
  bestScore: number | null
  ms: number
}

export async function retrieve(question: string, locale: Locale): Promise<RetrieveResult> {
  const started = Date.now()
  const db = await getDb()
  const { terms, priceIntent } = queryTerms(question)

  const [queryVector] = await embedProvider().embed!(env.EMBED_MODEL, [question], 'query')
  const cols = 'c.id, c.locale, c.ord, d.slug, d.is_price, c.source_label, c.text'

  const [vecRows, textRows] = await Promise.all([
    db.query<Row>(
      `select ${cols}, 1 - (c.embedding <=> $1::vector) as score
       from chunks c join documents d on d.id = c.document_id
       where c.embedding is not null and c.embed_model = $2
       order by c.embedding <=> $1::vector
       limit ${LEG_LIMIT}`,
      [toVectorLiteral(queryVector), embedModelLabel],
    ),
    terms.length
      ? db.query<Row>(
          `select ${cols}, ts_rank_cd(c.tsv, q) as score
           from chunks c join documents d on d.id = c.document_id, to_tsquery('simple', $1) q
           where c.tsv @@ q
           order by score desc
           limit ${LEG_LIMIT}`,
          // Основы состоят только из букв — экранировать нечего.
          [terms.join(' | ')],
        )
      : Promise.resolve([] as Row[]),
  ])

  const byId = new Map<number, RetrievedChunk & { row: Row; bonus: number }>()
  const entry = (row: Row) => {
    let e = byId.get(row.id)
    if (!e) {
      e = {
        chunkId: String(row.id),
        locale: row.locale,
        source: row.source_label,
        text: row.text,
        vecScore: null,
        vecRank: null,
        textScore: null,
        textRank: null,
        rrf: 0,
        n: null,
        row,
        // Небольшие поправки: свой язык и прайс на ценовой вопрос.
        bonus: (row.locale === locale ? 0.001 : 0) + (priceIntent && row.is_price ? 0.002 : 0),
      }
      byId.set(row.id, e)
    }
    return e
  }

  vecRows.forEach((row, i) => {
    const e = entry(row)
    e.vecScore = Number(row.score)
    e.vecRank = i + 1
  })
  textRows.forEach((row, i) => {
    const e = entry(row)
    e.textScore = Number(row.score)
    e.textRank = i + 1
  })

  for (const e of byId.values()) {
    e.rrf = (e.vecRank ? 1 / (RRF_K + e.vecRank) : 0) + (e.textRank ? 1 / (RRF_K + e.textRank) : 0) + e.bonus
  }

  // Один и тот же факт есть в RU и UZ версиях документа (тот же slug
  // и номер куска). Оставляем одну копию — на языке вопроса, если есть.
  const seen = new Set<string>()
  const ranked = [...byId.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .filter((e) => {
      const key = `${e.row.slug}#${e.row.ord}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, SHOW_LIMIT)

  ranked.forEach((e, i) => {
    if (i < env.RAG_TOP_K) e.n = i + 1
  })

  const bestScore = vecRows.length ? Number(vecRows[0].score) : null
  const chunks: RetrievedChunk[] = ranked.map(({ row: _row, bonus: _bonus, ...c }) => ({
    ...c,
    rrf: Number(c.rrf.toFixed(5)),
    vecScore: c.vecScore === null ? null : Number(c.vecScore.toFixed(4)),
    textScore: c.textScore === null ? null : Number(c.textScore.toFixed(4)),
  }))

  return { chunks, bestScore: bestScore === null ? null : Number(bestScore.toFixed(4)), ms: Date.now() - started }
}
