import type { Locale } from '../../shared/protocol.js'
import { env } from '../env.js'
import { accessToken, serviceAccount } from './auth.js'
import type { OfficeKind } from './convert.js'

/* ============================================================
   Google Drive: что лежит в папке базы знаний и как это скачать.

   Ожидаемая раскладка:
     <папка>/ru/prices.docx, faq.docx, …, schedule.xlsx
     <папка>/uz/…
     <папка>/doctors.xlsx — врачи и график (server/booking/doctors.ts)
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

/** Таблица врачей и графика в корне папки: одна на оба языка. */
export type DoctorsFile = RawFile & { kind: 'xlsx' }

export interface DriveFolder {
  files: DriveFile[]
  doctors: DoctorsFile | null
}

const baseName = (name: string) => name.replace(/\.(docx|xlsx)$/i, '').trim().toLowerCase()

/**
 * Что лежит в папке: документы из подпапок ru/ и uz/ и таблица
 * врачей doctors в корне. Имя doctors зарезервировано под неё: такой
 * документ в ru/ или uz/ пропускается (его собирает сервер из таблицы).
 */
export async function listFolder(): Promise<DriveFolder> {
  const top = await children(env.GOOGLE_DRIVE_FOLDER_ID!)
  const files: DriveFile[] = []
  let doctors: DoctorsFile | null = null
  for (const entry of top) {
    const name = baseName(entry.name)
    if (entry.mimeType !== FOLDER) {
      if (name === 'doctors' && kindOf(entry) === 'xlsx') doctors = { ...entry, kind: 'xlsx' }
      continue
    }
    if (name !== 'ru' && name !== 'uz') continue
    for (const f of await children(entry.id)) {
      const kind = kindOf(f)
      const slug = baseName(f.name)
      if (kind && slug !== 'doctors') files.push({ ...f, locale: name, slug, kind })
    }
  }
  return { files, doctors }
}

/** Содержимое файла в формате docx/xlsx. */
export async function download(file: Pick<DriveFile, 'id' | 'mimeType' | 'kind'>): Promise<Buffer> {
  const res =
    file.mimeType === GDOC || file.mimeType === GSHEET
      ? await call(`/files/${file.id}/export`, { mimeType: file.kind === 'docx' ? DOCX : XLSX })
      : await call(`/files/${file.id}`, { alt: 'media' })
  return Buffer.from(await res.arrayBuffer())
}
