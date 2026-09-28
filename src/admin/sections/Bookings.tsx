import { useEffect, useState } from 'react'
import type {
  AppointmentList,
  AppointmentRow,
  AppointmentScope,
  CancelResult,
  SheetPushResponse,
  SheetStatus,
} from '../../../shared/admin'
import { SERVICES, WEEKDAY_SHORT, weekdayOf } from '../../../shared/booking'
import { IconArrowUpRight, IconRetry } from '../../graphics/icons'
import { api, fmtDate } from '../api'
import { LoadState, Notice, SectionHead, Seg, Tag, errorText, useLoad } from '../ui'

/* ============================================================
   Записи на приём: кто, к кому и когда записался — с сайта или
   из чата. Здесь же отмена (окно снова становится свободным)
   и состояние копии в Google Таблице.
   ============================================================ */

const PAGE = 100

const SCOPES: { value: AppointmentScope; label: string }[] = [
  { value: 'upcoming', label: 'Предстоящие' },
  { value: 'past', label: 'Прошедшие' },
  { value: 'cancelled', label: 'Отменённые' },
  { value: 'all', label: 'Все' },
]

const EMPTY: Record<AppointmentScope, string> = {
  upcoming: 'Предстоящих записей нет. Запишитесь через форму на сайте — запись появится здесь.',
  past: 'Прошедших записей нет.',
  cancelled: 'Отменённых записей нет.',
  all: 'Записей пока нет.',
}

type Flash = { tone: 'good' | 'bad' | 'neutral'; text: string }

/** «пн 29.09» — день недели помогает администратору больше, чем год. */
const dayLabel = (date: string) => {
  const [, m, d] = date.split('-')
  return `${WEEKDAY_SHORT.ru[weekdayOf(date) - 1]} ${d}.${m}`
}

export function Bookings() {
  const [scope, setScope] = useState<AppointmentScope>('upcoming')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [sheet, setSheet] = useState<SheetStatus | null>(null)
  const [pushing, setPushing] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim())
      setOffset(0)
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const query = new URLSearchParams({ scope, q: search, limit: String(PAGE), offset: String(offset) })
  const { data, error, loading, reload } = useLoad<AppointmentList>(`/appointments?${query}`)
  // Свежий статус Таблицы — из последнего ответа (список, отмена или отправка).
  useEffect(() => setSheet(data?.sheet ?? null), [data])

  // Новые записи приходят сами: пока раздел открыт, обновляем раз в 30 секунд.
  useEffect(() => {
    const t = setInterval(reload, 30_000)
    return () => clearInterval(t)
  }, [reload])

  const push = async () => {
    setPushing(true)
    setFlash(null)
    try {
      const res = await api<SheetPushResponse>('/appointments/sheet', { body: {} })
      setSheet(res.sheet)
      setFlash(
        res.error
          ? { tone: 'bad', text: `Google не принял данные: ${res.error}` }
          : res.pushed === null
            ? { tone: 'neutral', text: 'Отправка уже идёт — обновите через минуту.' }
            : { tone: 'good', text: res.pushed ? `Отправлено строк: ${res.pushed}.` : 'Всё уже в таблице.' },
      )
      reload()
    } catch (err) {
      setFlash({ tone: 'bad', text: errorText(err) })
    } finally {
      setPushing(false)
    }
  }

  const onCancelled = (res: CancelResult) => {
    setSheet(res.sheet)
    const a = res.appointment
    setFlash({
      tone: 'good',
      text: `Запись ${a.code} отменена: ${a.doctor}, ${dayLabel(a.date)} в ${a.time} снова свободно.${
        res.sheet.enabled && !res.sheet.pending ? ' В таблице отмечено.' : ''
      }`,
    })
    reload()
  }

  return (
    <>
      <SectionHead
        title="Записи"
        lede="Записи с сайта и из чата. База не даёт записать двоих на одно время к одному врачу. Отмена освобождает окно — его снова видят форма и ассистент. Копия каждой записи уходит в Google Таблицу."
        actions={
          <button type="button" className="btn btn--secondary btn--small" onClick={reload}>
            <IconRetry size={16} /> Обновить
          </button>
        }
      />

      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
      {sheet && <SheetPanel sheet={sheet} pushing={pushing} onPush={push} />}

      <div className="toolbar">
        <Seg
          label="Какие записи"
          value={scope}
          options={SCOPES}
          onChange={(v) => {
            setScope(v)
            setOffset(0)
          }}
        />
        <input
          className="input input--small toolbar__grow"
          type="search"
          placeholder="Номер, имя или телефон"
          aria-label="Поиск по номеру, имени или телефону"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {data && data.rows.length > 0 ? (
        <>
          <div className="table-wrap" data-loading={loading}>
            <table className="table bookings">
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Врач</th>
                  <th>Пациент</th>
                  <th>Комментарий</th>
                  <th>Запись</th>
                  <th>
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <BookingRow key={r.code} r={r} sheetOn={Boolean(sheet?.enabled)} onCancelled={onCancelled} onError={setFlash} />
                ))}
              </tbody>
            </table>
          </div>
          {data.total > PAGE && (
            <div className="pager">
              <span className="muted">
                {offset + 1}–{offset + data.rows.length} из {data.total}
              </span>
              <button
                type="button"
                className="btn btn--secondary btn--small"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
              >
                Назад
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--small"
                disabled={offset + PAGE >= data.total}
                onClick={() => setOffset(offset + PAGE)}
              >
                Дальше
              </button>
            </div>
          )}
        </>
      ) : (
        <LoadState loading={loading} error={error} empty={search ? 'По этому поиску ничего нет.' : EMPTY[scope]} />
      )}
    </>
  )
}

function SheetPanel({ sheet, pushing, onPush }: { sheet: SheetStatus; pushing: boolean; onPush: () => void }) {
  return (
    <section className="card panel">
      <h2 className="panel__title">Google Таблица</h2>
      {sheet.enabled ? (
        <>
          <dl className="facts">
            <dt>Статус</dt>
            <dd>
              {sheet.lastError ? (
                <Tag tone="bad">ошибка отправки</Tag>
              ) : sheet.pending ? (
                <Tag tone="warn">ждут отправки: {sheet.pending}</Tag>
              ) : (
                <Tag tone="good">всё отправлено</Tag>
              )}
            </dd>
            <dt>Таблица</dt>
            <dd>
              {sheet.url && (
                <a href={sheet.url} target="_blank" rel="noopener">
                  Открыть лист «Записи» <IconArrowUpRight size={14} />
                </a>
              )}
            </dd>
            <dt>Последняя отправка</dt>
            <dd>{sheet.lastOkAt ? fmtDate(sheet.lastOkAt) : 'ещё не было'}</dd>
            {sheet.serviceEmail && (
              <>
                <dt>Сервисный аккаунт</dt>
                <dd>
                  <code>{sheet.serviceEmail}</code> <span className="muted small">— нужен доступ «Редактор»</span>
                </dd>
              </>
            )}
          </dl>
          {sheet.lastError && (
            <Notice tone="bad">
              Google ответил ошибкой: <code>{sheet.lastError}</code>. Записи сохранены в базе и уйдут в таблицу при следующей
              отправке. Проверьте, что таблица открыта сервисному аккаунту как редактору и что Google Sheets API включён.
            </Notice>
          )}
          {(sheet.pending > 0 || sheet.lastError) && (
            <button type="button" className="btn btn--secondary btn--small" disabled={pushing} onClick={onPush}>
              <IconRetry size={16} /> {pushing ? 'Отправляю…' : 'Отправить в таблицу'}
            </button>
          )}
        </>
      ) : (
        <Notice tone="warn">
          Копия в Google Таблице выключена{sheet.problem && <> — <strong>{sheet.problem}</strong></>}. Записи всё равно
          сохраняются в базе и видны здесь. Как подключить таблицу — в README.
        </Notice>
      )}
    </section>
  )
}

function BookingRow({
  r,
  sheetOn,
  onCancelled,
  onError,
}: {
  r: AppointmentRow
  sheetOn: boolean
  onCancelled: (res: CancelResult) => void
  onError: (f: Flash) => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const future = Date.parse(r.startsAt) > Date.now()

  const cancel = async () => {
    setBusy(true)
    try {
      onCancelled(await api<CancelResult>(`/appointments/${encodeURIComponent(r.code)}/cancel`, { body: {} }))
    } catch (err) {
      onError({ tone: 'bad', text: errorText(err) })
      setBusy(false)
      setConfirm(false)
    }
  }

  return (
    <tr data-status={r.status}>
      <td className="bookings__when">
        <strong>{dayLabel(r.date)}</strong> {r.time}
      </td>
      <td>
        {r.doctor}
        <p className="small muted">{SERVICES[r.service]?.ru ?? r.service}</p>
      </td>
      <td>
        {r.patientName}
        <p className="small">
          <a href={`tel:${r.patientPhone.replace(/\s/g, '')}`}>{r.patientPhone}</a>
        </p>
      </td>
      <td className="bookings__comment">{r.comment ?? <span className="muted">—</span>}</td>
      <td>
        <code>{r.code}</code>{' '}
        <Tag tone={r.source === 'chat' ? 'accent' : 'neutral'}>{r.source === 'chat' ? 'чат' : 'сайт'}</Tag>{' '}
        <Tag>{r.locale.toUpperCase()}</Tag>
        <p className="small muted">
          {r.status === 'cancelled' && r.cancelledAt ? `отменена ${fmtDate(r.cancelledAt)}` : `создана ${fmtDate(r.createdAt)}`}
          {sheetOn && !r.synced && ' · ещё не в таблице'}
        </p>
      </td>
      <td className="table__actions">
        {r.status === 'cancelled' ? (
          <Tag tone="warn">отменена</Tag>
        ) : !future ? (
          <span className="muted small">прошла</span>
        ) : confirm ? (
          <span className="bookings__confirm">
            <button type="button" className="btn btn--quiet btn--small btn--danger" disabled={busy} onClick={cancel}>
              {busy ? 'Отменяю…' : 'Да, отменить'}
            </button>
            <button type="button" className="btn btn--quiet btn--small" disabled={busy} onClick={() => setConfirm(false)}>
              Нет
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn--secondary btn--small" onClick={() => setConfirm(true)}>
            Отменить
          </button>
        )}
      </td>
    </tr>
  )
}
