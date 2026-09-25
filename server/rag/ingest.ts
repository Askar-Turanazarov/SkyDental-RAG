import { createHash } from 'node:crypto'
import { chunkMarkdown, documentTitle } from '../../shared/chunker.js'
import type { Locale } from '../../shared/protocol.js'
import { stems } from '../../shared/text.js'
import { getDb, toVectorLiteral } from '../db/client.js'
import { env } from '../env.js'
import { embedModelLabel, embedProvider } from '../llm/registry.js'

/* ============================================================
   ИНДЕКСАЦИЯ (ingest): документ → куски → векторы → таблица chunks.

   1. markdown режется на куски (shared/chunker.ts);
   2. для каждого куска считается хеш «модель эмбеддингов + текст»;
   3. вектор пересчитывается ТОЛЬКО для кусков с новым хешем,
      остальные берут старый вектор. Поправили одну цену в прайсе —
      пересчитается один кусок, а не весь документ. Это экономит
      запросы к API и хорошо видно в админке («пересчитано 1 из 27»).
   ============================================================ */

/** Что именно превращается в вектор: подпись источника + текст. */
function embedInput(sourceLabel: string, text: string): string {
  return `${sourceLabel}\n${text}`
}

function contentHash(input: string): string {
  return createHash('sha256').update(`${embedModelLabel}\n${input}`).digest('hex').slice(0, 32)
}

export interface IndexReport {
  documentId: number
  total: number
  embedded: number
  reused: number
}

export async function indexDocument(documentId: number): Promise<IndexReport> {
  const db = await getDb()
  const [doc] = await db.query<{ locale: Locale; body_md: string }>(
    'select locale, body_md from documents where id = $1',
    [documentId],
  )
  if (!doc) throw new Error(`Документ ${documentId} не найден`)

  const pieces = chunkMarkdown(doc.body_md).map((c) => {
    const input = embedInput(c.sourceLabel, c.text)
    return { ...c, input, hash: contentHash(input) }
  })

  // Векторы, которые уже посчитаны для таких же кусков.
  const existing = await db.query<{ content_hash: string; embedding: string }>(
    'select content_hash, embedding::text as embedding from chunks where document_id = $1 and embedding is not null',
    [documentId],
  )
  const known = new Map(existing.map((r) => [r.content_hash, r.embedding]))

  const fresh = pieces.filter((p) => !known.has(p.hash))
  if (fresh.length) {
    const vectors = await embedProvider().embed!(env.EMBED_MODEL, fresh.map((p) => p.input), 'document')
    fresh.forEach((p, i) => known.set(p.hash, toVectorLiteral(vectors[i])))
  }

  const rows = pieces.map((p) => ({
    ord: p.ord,
    heading: p.heading,
    source_label: p.sourceLabel,
    text: p.text,
    search_stems: stems(p.searchText).join(' '),
    embedding: known.get(p.hash)!,
    content_hash: p.hash,
  }))

  // Старые куски документа заменяются новыми одним запросом:
  // jsonb_to_recordset разворачивает массив строк в таблицу —
  // один сетевой круг до Neon вместо десятков insert.
  await db.query('delete from chunks where document_id = $1', [documentId])
  if (rows.length) {
    await db.query(
      `insert into chunks (document_id, ord, locale, heading, source_label, text, search_stems, embedding, embed_model, content_hash)
       select $1, x.ord, $2, x.heading, x.source_label, x.text, x.search_stems, x.embedding::vector, $3, x.content_hash
       from jsonb_to_recordset($4::jsonb) as x(ord int, heading text, source_label text, text text,
                                               search_stems text, embedding text, content_hash text)`,
      [documentId, doc.locale, embedModelLabel, JSON.stringify(rows)],
    )
  }

  return { documentId, total: rows.length, embedded: fresh.length, reused: rows.length - fresh.length }
}

export interface SaveDocumentInput {
  locale: Locale
  slug: string
  bodyMd: string
  isPrice?: boolean
  note?: string
}

/**
 * Создать или обновить документ, записать версию в историю и
 * переиндексировать. Если текст не изменился — ничего не делает.
 */
export async function saveDocument(input: SaveDocumentInput): Promise<{ id: number; version: number; changed: boolean; index: IndexReport | null }> {
  const db = await getDb()
  const title = documentTitle(input.bodyMd) || input.slug
  const [current] = await db.query<{ id: number; version: number; body_md: string }>(
    'select id, version, body_md from documents where locale = $1 and slug = $2',
    [input.locale, input.slug],
  )

  if (current && current.body_md === input.bodyMd) {
    return { id: current.id, version: current.version, changed: false, index: null }
  }

  let id: number
  let version: number
  if (current) {
    version = current.version + 1
    id = current.id
    await db.query('update documents set body_md = $1, title = $2, version = $3, updated_at = now() where id = $4', [
      input.bodyMd,
      title,
      version,
      id,
    ])
  } else {
    version = 1
    const [row] = await db.query<{ id: number }>(
      'insert into documents (locale, slug, title, body_md, is_price, version) values ($1, $2, $3, $4, $5, 1) returning id',
      [input.locale, input.slug, title, input.bodyMd, input.isPrice ?? input.slug === 'prices'],
    )
    id = row.id
  }
  await db.query('insert into document_versions (document_id, version, body_md, note) values ($1, $2, $3, $4)', [
    id,
    version,
    input.bodyMd,
    input.note ?? null,
  ])

  const index = await indexDocument(id)
  return { id, version, changed: true, index }
}

/** Переиндексировать всё (например, после смены модели эмбеддингов). */
export async function reindexAll(): Promise<IndexReport[]> {
  const db = await getDb()
  const docs = await db.query<{ id: number }>('select id from documents order by id')
  const reports: IndexReport[] = []
  for (const d of docs) reports.push(await indexDocument(d.id))
  return reports
}
