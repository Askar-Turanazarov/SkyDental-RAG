import { useEffect, useState } from 'react'
import type { SyncAction, SyncLogEntry, SyncRunResult, SyncStatus, SyncTrigger } from '../../../shared/admin'
import { IconArrowUpRight, IconRetry } from '../../graphics/icons'
import { api, fmtDate } from '../api'
import { LoadState, Notice, SectionHead, Tag, errorText, useLoad } from '../ui'
import type { Tone } from '../ui'

/* ============================================================
   Синхронизация с Google Drive: подключена ли папка, когда её
   проверяли и журнал изменений — что поменялось в файлах, сколько
   строк и сколько фрагментов пришлось пересчитать.
   ============================================================ */

const ACTION: Record<SyncAction, { label: string; tone: Tone }> = {
  linked: { label: 'подключён', tone: 'neutral' },
  added: { label: 'добавлен', tone: 'good' },
  updated: { label: 'обновлён', tone: 'accent' },
  removed: { label: 'удалён', tone: 'warn' },
  error: { label: 'ошибка', tone: 'bad' },
}

const TRIGGER: Record<SyncTrigger, string> = {
  chat: 'вопрос в чате',
  admin: 'кнопка в админке',
  seed: 'npm run seed',
}

export function Sync() {
  const { data, error, loading, reload } = useLoad<SyncStatus>('/sync')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ tone: 'good' | 'bad' | 'neutral'; text: string } | null>(null)

  // Журнал живой: пока раздел открыт, подтягиваем его раз в 15 секунд.
  useEffect(() => {
    const t = setInterval(reload, 15_000)
    return () => clearInterval(t)
  }, [reload])

  const check = async () => {
    setBusy(true)
    setFlash(null)
    try {
      const res = await api<SyncRunResult>('/sync', { body: {} })
      const errors = res.changes.filter((c) => c.action === 'error').length
      setFlash(
        errors
          ? { tone: 'bad', text: `Проверено, есть ошибки: ${errors}. Подробности — в журнале.` }
          : res.changes.length
            ? { tone: 'good', text: `Файлов в папке: ${res.files}. Изменений: ${res.changes.length}.` }
            : { tone: 'neutral', text: `Файлов в папке: ${res.files}. Изменений нет — бот уже знает актуальную версию.` },
      )
      reload()
    } catch (err) {
      setFlash({ tone: 'bad', text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SectionHead
        title="Синхронизация"
        lede="Документы базы знаний лежат в папке Google Drive. Перед ответом бот сверяется с папкой (не чаще раза в интервал) и подтягивает изменённые файлы: пересчитываются только фрагменты, которые действительно поменялись."
        actions={
          data?.enabled && (
            <button type="button" className="btn btn--secondary btn--small" disabled={busy} onClick={check}>
              <IconRetry size={16} /> {busy ? 'Проверяю…' : 'Проверить сейчас'}
            </button>
          )
        }
      />

      {!data ? (
        <LoadState loading={loading} error={error} />
      ) : (
        <>
          {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}

          <section className="card panel">
            <h2 className="panel__title">Папка</h2>
            {data.enabled ? (
              <dl className="facts">
                <dt>Статус</dt>
                <dd>
                  <Tag tone="good">подключена</Tag>
                </dd>
                <dt>Папка</dt>
                <dd>
                  {data.folderUrl && (
                    <a href={data.folderUrl} target="_blank" rel="noopener">
                      Открыть в Google Drive <IconArrowUpRight size={14} />
                    </a>
                  )}
                </dd>
                <dt>Сервисный аккаунт</dt>
                <dd>
                  <code>{data.serviceEmail}</code>
                </dd>
                <dt>Последняя проверка</dt>
                <dd>{data.checkedAt ? fmtDate(data.checkedAt) : 'ещё не было'}</dd>
                <dt>Интервал</dt>
                <dd>
                  не чаще раза в {data.intervalSec} с <span className="muted small">DRIVE_SYNC_INTERVAL_SEC</span>
                </dd>
              </dl>
            ) : (
              <Notice tone="warn">
                Google Drive не подключён: задайте <code>GOOGLE_DRIVE_FOLDER_ID</code> и{' '}
                <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> (в <code>.env</code> и в Vercel → Environment Variables). Пока бот
                отвечает по документам, которые уже есть в базе. Инструкция — в README.
              </Notice>
            )}
          </section>

          <section className="card panel">
            <h2 className="panel__title">Журнал изменений</h2>
            {data.log.length ? <LogTable rows={data.log} /> : <p className="muted">Изменений пока не было.</p>}
          </section>
        </>
      )}
    </>
  )
}

function LogTable({ rows }: { rows: SyncLogEntry[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Когда</th>
            <th>Документ</th>
            <th>Что произошло</th>
            <th className="num">Строки</th>
            <th className="num">Фрагменты</th>
            <th>Причина проверки</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{fmtDate(r.createdAt)}</td>
              <td>
                {r.locale ? (
                  <>
                    <Tag>{r.locale.toUpperCase()}</Tag> {r.fileName ?? r.slug}
                  </>
                ) : (
                  <span className="muted">вся папка</span>
                )}
              </td>
              <td>
                <Tag tone={ACTION[r.action].tone}>{ACTION[r.action].label}</Tag>
                {r.version !== null && <span className="muted small"> v{r.version}</span>}
                {r.message && <p className="small muted">{r.message}</p>}
              </td>
              <td className="num">
                {r.linesAdded !== null || r.linesRemoved !== null ? (
                  <>
                    <span title="добавлено строк">+{r.linesAdded ?? 0}</span> /{' '}
                    <span title="удалено строк">−{r.linesRemoved ?? 0}</span>
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td className="num">
                {r.chunksTotal !== null ? `пересчитано ${r.chunksEmbedded ?? 0} из ${r.chunksTotal}` : '—'}
              </td>
              <td className="muted">{TRIGGER[r.trigger]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
