import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Stats as StatsData } from '../../../shared/admin'
import { fmtMs, pct } from '../api'
import { LoadState, SectionHead, Seg, useLoad } from '../ui'

/* ============================================================
   Статистика: как часто база знаний выручает, сколько отказов
   и почему, как часто срабатывает fallback, насколько быстро.
   ============================================================ */

const DAYS = [
  { value: 1, label: 'Сутки' },
  { value: 7, label: '7 дней' },
  { value: 30, label: '30 дней' },
  { value: 90, label: '90 дней' },
] as const

const DAY = 86_400_000

export function Stats() {
  const [days, setDays] = useState<number>(7)
  const { data, error, loading } = useLoad<StatsData>(`/stats?days=${days}`)

  return (
    <>
      <SectionHead
        title="Статистика"
        lede="Все цифры — из таблицы трасс: каждый вопрос к боту записывается вместе с результатом поиска, моделью и временем."
        actions={<Seg label="Период" value={days} options={DAYS} onChange={setDays} />}
      />
      {data ? <StatsView s={data} loading={loading} /> : <LoadState loading={loading} error={error} />}
    </>
  )
}

function StatsView({ s, loading }: { s: StatsData; loading: boolean }) {
  if (!s.total) return <div className="empty">За этот период вопросов не было.</div>
  const rated = s.feedback.up + s.feedback.down

  return (
    <div className="stack" data-loading={loading}>
      <div className="kpis">
        <Kpi label="Вопросов" value={s.total} sub={`RAG ${s.rag} · без RAG ${s.noRag}`} />
        <Kpi label="Ответ из базы" value={pct(s.found, s.rag)} sub={`${s.found} из ${s.rag} вопросов в режиме RAG`} tone="good" />
        <Kpi
          label="Честные отказы"
          value={pct(s.notFound, s.rag)}
          sub={`ниже порога ${s.refusals['below-threshold']} · поиск пуст ${s.refusals['no-chunks']} · модель не нашла ${s.refusals['model-declined']}`}
          tone={s.notFound ? 'warn' : undefined}
        />
        <Kpi
          label="Fallback"
          value={s.fallbacks}
          sub={`${pct(s.fallbacks, s.total)} ответов — не с первой модели цепочки`}
          tone={s.fallbacks ? 'warn' : undefined}
        />
        <Kpi
          label="Сбои"
          value={s.failed}
          sub="вся цепочка моделей не ответила"
          tone={s.failed ? 'bad' : undefined}
        />
        <Kpi label="Задержка p50" value={fmtMs(s.latency.p50)} sub={`p95 — ${fmtMs(s.latency.p95)}`} />
        <Kpi
          label="Оценки"
          value={rated ? pct(s.feedback.up, rated) : '—'}
          sub={`хорошо ${s.feedback.up} · плохо ${s.feedback.down} · с комментарием ${s.feedback.commented}`}
          tone={s.feedback.down > s.feedback.up ? 'bad' : undefined}
        />
      </div>

      <section className="card panel">
        <h2 className="panel__title">По дням</h2>
        <DayChart s={s} />
        <p className="legend muted small">
          <span className="legend__dot" data-kind="total" /> вопросы <span className="legend__dot" data-kind="nf" /> без
          ответа из базы
        </p>
      </section>

      <div className="grid-2">
        <section className="card panel">
          <h2 className="panel__title">Кто отвечал</h2>
          {s.byModel.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Модель</th>
                    <th className="num">Ответов</th>
                    <th className="num">Среднее время</th>
                    <th className="num">Плохих оценок</th>
                  </tr>
                </thead>
                <tbody>
                  {s.byModel.map((m) => (
                    <tr key={m.model}>
                      <td>
                        <code>{m.model}</code>
                      </td>
                      <td className="num">{m.answers}</td>
                      <td className="num">{fmtMs(m.avgMs)}</td>
                      <td className="num">{m.down}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Модель ещё ни разу не вызывалась: все вопросы закончились отказом до генерации.</p>
          )}
        </section>

        <section className="card panel">
          <h2 className="panel__title">Ошибки моделей</h2>
          {s.attemptErrors.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Модель</th>
                    <th className="num">Ошибок</th>
                    <th>Последняя</th>
                  </tr>
                </thead>
                <tbody>
                  {s.attemptErrors.map((m) => (
                    <tr key={m.model}>
                      <td>
                        <code>{m.model}</code>
                      </td>
                      <td className="num">{m.errors}</td>
                      <td className="muted">{m.lastDetail ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Ни одной ошибки: fallback не понадобился.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className="card kpi" data-tone={tone}>
      <p className="kpi__label">{label}</p>
      <p className="kpi__value">{value}</p>
      <p className="kpi__sub">{sub}</p>
    </div>
  )
}

function DayChart({ s }: { s: StatsData }) {
  // Дни без вопросов тоже показываем — пустой столбик честнее пропуска.
  const byDay = new Map(s.perDay.map((d) => [d.day, d]))
  const series = Array.from({ length: s.days }, (_, i) => {
    const day = new Date(Date.now() - (s.days - 1 - i) * DAY).toISOString().slice(0, 10)
    return byDay.get(day) ?? { day, total: 0, notFound: 0, down: 0 }
  })
  const max = Math.max(1, ...series.map((d) => d.total))

  return (
    <div className="chart" role="img" aria-label={`Вопросы по дням за ${s.days} дн.`}>
      {series.map((d) => (
        <div
          key={d.day}
          className="chart__col"
          title={`${d.day}: ${d.total} вопросов, без ответа ${d.notFound}, плохих оценок ${d.down}`}
          style={{ '--h': `${(d.total / max) * 100}%`, '--nf': `${d.total ? (d.notFound / d.total) * 100 : 0}%` } as CSSProperties}
        >
          <span className="chart__bar" />
          {s.days <= 31 && <span className="chart__label">{d.day.slice(8)}</span>}
        </div>
      ))}
    </div>
  )
}
