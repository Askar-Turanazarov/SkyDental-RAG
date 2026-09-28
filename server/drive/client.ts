import type { Locale } from '../../shared/protocol.js'
import { env } from '../env.js'
import { accessToken, serviceAccount } from './auth.js'
import type { OfficeKind } from './convert.js'

/* ============================================================
   Google Drive: что лежит в папке базы знаний и как это скачать.

   Ожидаемая раскладка:
     <папка>/ru/prices.docx, faq.docx, …, schedule.xlsx
     <папка>/uz/…
   Имя файла без расширения — slug документа. Подходят и файлы
   Word/Excel, загруженные в Drive, и «родные» Google Документы/
   Таблицы: вторые экспортируются в docx/xlsx на лету.
   ============================================================ */

const API = 'https://www.googleapis.com/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
const GDOC = 'application/vnd.google-apps.document'
const GSHEET = 'application/vnd.google-apps.spreadsheet'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  webViewLink: string
  locale: Locale
  slug: string
  kind: OfficeKind
}

export function driveEnabled(): boolean {
  return Boolean(env.GOOGLE_DRIVE_FOLDER_ID && serviceAccount())
}

async function call(path: string, params: Record<string, string>): Promise<Response> {
  const url = `${API}${path}?${new URLSearchParams({ supportsAllDrives: 'true', ...params })}`
  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } })
  if (!res.ok) throw new Error(`Google Drive ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res
}

interface RawFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  webViewLink: string
}

async function children(folderId: string): Promise<RawFile[]> {
  const out: RawFile[] = []
  let pageToken = ''
  do {
    const res = await call('/files', {
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)',
      pageSize: '100',
      includeItemsFromAllDrives: 'true',
      ...(pageToken ? { pageToken } : {}),
    })
    const data = (await res.json()) as { files: RawFile[]; nextPageToken?: string }
    out.push(...data.files)
    pageToken = data.nextPageToken ?? ''
  } while (pageToken)
  return out
}

function kindOf(f: RawFile): OfficeKind | null {
  if (f.mimeType === GDOC || f.mimeType === DOCX || /\.docx$/i.test(f.name)) return 'docx'
  if (f.mimeType === GSHEET || f.mimeType === XLSX || /\.xlsx$/i.test(f.name)) return 'xlsx'
  return null
}

/** Все документы базы знаний в папке: подпапки ru/ и uz/. */
export async function listFolder(): Promise<DriveFile[]> {
  const top = await children(env.GOOGLE_DRIVE_FOLDER_ID!)
  const files: DriveFile[] = []
  for (const dir of top) {
    const locale = dir.name.trim().toLowerCase()
    if (dir.mimeType !== FOLDER || (locale !== 'ru' && locale !== 'uz')) continue
    for (const f of await children(dir.id)) {
      const kind = kindOf(f)
      if (!kind) continue
      const slug = f.name.replace(/\.(docx|xlsx)$/i, '').trim().toLowerCase()
      files.push({ ...f, locale, slug, kind })
    }
  }
  return files
}

/** Содержимое файла в формате docx/xlsx. */
export async function download(file: DriveFile): Promise<Buffer> {
  const res =
    file.mimeType === GDOC || file.mimeType === GSHEET
      ? await call(`/files/${file.id}/export`, { mimeType: file.kind === 'docx' ? DOCX : XLSX })
      : await call(`/files/${file.id}`, { alt: 'media' })
  return Buffer.from(await res.arrayBuffer())
}
