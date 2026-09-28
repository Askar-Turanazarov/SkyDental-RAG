import type { SyncAction, SyncLogEntry, SyncRunResult, SyncStatus, SyncTrigger } from '../../shared/admin.js'
import { lineDiff } from '../../shared/diff.js'
import type { Locale } from '../../shared/protocol.js'
import { getDb } from '../db/client.js'
import { serviceAccount, serviceAccountError } from '../drive/auth.js'
import { download, driveEnabled, listFolder } from '../drive/client.js'
import type { DriveFile } from '../drive/client.js'
import { officeToMarkdown } from '../drive/convert.js'
import { env } from '../env.js'
import { saveDocument } from './ingest.js'

/* ============================================================
   СИНХРОНИЗАЦИЯ с Google Drive: папка → таблица documents.

   Когда: перед поиском в каждом вопросе чата, но не чаще раза в
   DRIVE_SYNC_INTERVAL_SEC, и по кнопке в админке. Отдельного
   расписания нет — бот сверяется с Drive именно тогда, когда ему
   нужны данные, поэтому правка в файле видна уже в следующем ответе.

   Как:
   1. условный update в sync_state — «замок»: из параллельных
      запросов Drive спрашивает только один;
   2. список файлов папки с modifiedTime — один дешёвый запрос;
   3. скачиваются только файлы с новым modifiedTime, дальше обычный
      saveDocument(): версия, пропуск неизменившегося текста и
      пересчёт векторов только у изменённых фрагментов;
   4. файл пропал из Drive — документ удаляется.
   Каждое реальное изменение и каждая ошибка пишутся в sync_log.
   ============================================================ */

interface DocState {
  id: number
  locale: Locale
  slug: string
  source: 'local' | 'drive'
  drive_file_id: string | null
  drive_modified_at: string | null
  body_md: string
}

type LogInput = Omit<SyncLogEntry, 'id' | 'createdAt' | 'trigger'>

const LOG_COLUMNS = `id, created_at as "createdAt", trigger, locale, slug, file_name as "fileName", action, version,
  lines_added as "linesAdded", lines_removed as "linesRemoved", chunks_embedded as "chunksEmbedded",
  chunks_total as "chunksTotal", message`

async function log(trigger: SyncTrigger, e: Partial<LogInput> & { action: SyncAction }): Promise<SyncLogEntry> {
  const db = await getDb()
  const [row] = await db.query<SyncLogEntry>(
    `insert into sync_log (trigger, locale, slug, file_name, action, version, lines_added, lines_removed,
       chunks_embedded, chunks_total, message)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning ${LOG_COLUMNS}`,
    [
      trigger,
      e.locale ?? null,
      e.slug ?? null,
      e.fileName ?? null,
      e.action,
      e.version ?? null,
      e.linesAdded ?? null,
      e.linesRemoved ?? null,
      e.chunksEmbedded ?? null,
      e.chunksTotal ?? null,
      e.message ?? null,
    ],
  )
  return row
}

/** Взять «замок» проверки. force — в обход интервала (кнопка в админке). */
async function acquire(force: boolean): Promise<boolean> {
  const db = await getDb()
  const rows = await db.query(
    `update sync_state set checked_at = now()
     where id = 1 and ($1::boolean or checked_at < now() - make_interval(secs => $2::int))
     returning id`,
    [force, env.DRIVE_SYNC_INTERVAL_SEC],
  )
  return rows.length > 0
}

const errorText = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 500)

async function syncFile(trigger: SyncTrigger, f: DriveFile, doc: DocState | undefined): Promise<SyncLogEntry | null> {
  const db = await getDb()
  const bodyMd = await officeToMarkdown(f.kind, await download(f))
  if (!bodyMd.trim()) throw new Error('файл пустой или не распознан')

  const res = await saveDocument({ locale: f.locale, slug: f.slug, bodyMd, note: `Google Drive: ${f.name}` })
  await db.query(
    `update documents set source = 'drive', drive_file_id = $2, drive_modified_at = $3, drive_url = $4 where id = $1`,
    [res.id, f.id, f.modifiedTime, f.webViewLink],
  )

  const base = { locale: f.locale, slug: f.slug, fileName: f.name, version: res.version }
  if (!res.changed) {
    // Текст тот же. Отмечаем только первое подключение документа к Drive.
    return doc?.source === 'drive' ? null : log(trigger, { ...base, action: 'linked' })
  }
  const diff = lineDiff(doc?.body_md ?? '', bodyMd)
  return log(trigger, {
    ...base,
    action: doc ? 'updated' : 'added',
    linesAdded: diff.filter((l) => l.op === '+').length,
    linesRemoved: diff.filter((l) => l.op === '-').length,
    chunksEmbedded: res.index?.embedded ?? null,
    chunksTotal: res.index?.total ?? null,
  })
}

export async function syncFromDrive(trigger: SyncTrigger, force = false): Promise<SyncRunResult> {
  if (!driveEnabled() || !(await acquire(force))) return { checked: false, files: 0, changes: [] }

  const db = await getDb()
  const changes: SyncLogEntry[] = []
  let files: DriveFile[]
  try {
    files = await listFolder()
  } catch (err) {
    // Одна и та же ошибка каждые 20 секунд не нужна в журнале: пишем, только если она новая.
    const message = errorText(err)
    const [last] = await db.query<{ message: string | null }>('select message from sync_log order by id desc limit 1')
    if (last?.message !== message) changes.push(await log(trigger, { action: 'error', message }))
    return { checked: true, files: 0, changes }
  }

  const docs = await db.query<DocState>(
    'select id, locale, slug, source, drive_file_id, drive_modified_at, body_md from documents',
  )
  const byKey = new Map(docs.map((d) => [`${d.locale}/${d.slug}`, d]))

  for (const f of files) {
    const doc = byKey.get(`${f.locale}/${f.slug}`)
    if (doc?.drive_file_id === f.id && doc.drive_modified_at === f.modifiedTime) continue
    try {
      const entry = await syncFile(trigger, f, doc)
      if (entry) changes.push(entry)
    } catch (err) {
      console.error('[sync]', f.name, err)
      changes.push(await log(trigger, { locale: f.locale, slug: f.slug, fileName: f.name, action: 'error', message: errorText(err) }))
    }
  }

  // Удалённые из Drive: только документы, которые пришли из Drive.
  const present = new Set(files.map((f) => `${f.locale}/${f.slug}`))
  for (const d of docs) {
    if (d.source !== 'drive' || present.has(`${d.locale}/${d.slug}`)) continue
    await db.query('delete from documents where id = $1', [d.id])
    changes.push(await log(trigger, { locale: d.locale, slug: d.slug, action: 'removed' }))
  }

  return { checked: true, files: files.length, changes }
}

/**
 * Для чата: свериться с Drive, но не держать ответ дольше `ms`.
 * Сбой Drive не ломает ответ — бот отвечает по тому, что уже в базе.
 */
export async function syncBeforeAnswer(ms = 8000): Promise<void> {
  if (!driveEnabled()) return
  const run = syncFromDrive('chat').catch((err) => console.error('[sync]', err))
  await Promise.race([run, new Promise((r) => setTimeout(r, ms))])
}

export async function syncStatus(limit = 50): Promise<SyncStatus> {
  const db = await getDb()
  const [state] = await db.query<{ checkedAt: string }>(
    `select checked_at as "checkedAt" from sync_state where id = 1 and checked_at > 'epoch'`,
  )
  const log = await db.query<SyncLogEntry>(`select ${LOG_COLUMNS} from sync_log order by id desc limit $1`, [limit])
  const folder = env.GOOGLE_DRIVE_FOLDER_ID
  return {
    enabled: driveEnabled(),
    problem: !folder
      ? 'не задан GOOGLE_DRIVE_FOLDER_ID'
      : !env.GOOGLE_SERVICE_ACCOUNT_JSON
        ? 'не задан GOOGLE_SERVICE_ACCOUNT_JSON'
        : !serviceAccount()
          ? `GOOGLE_SERVICE_ACCOUNT_JSON не читается: ${serviceAccountError ?? 'неизвестная ошибка'}`
          : null,
    folderUrl: folder ? `https://drive.google.com/drive/folders/${folder}` : null,
    serviceEmail: serviceAccount()?.client_email ?? null,
    checkedAt: state?.checkedAt ?? null,
    intervalSec: env.DRIVE_SYNC_INTERVAL_SEC,
    log,
  }
}
