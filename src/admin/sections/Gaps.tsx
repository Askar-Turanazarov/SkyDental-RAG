import { useState } from 'react'
import type { GapGroup } from '../../../shared/admin'
import type { RefusalReason } from '../../../shared/protocol'
import { fmtDate } from '../api'
import { LoadState, REFUSAL_LABEL, SectionHead, Seg, Tag, f2, href, useLoad } from '../ui'

/* ============================================================
   Пробелы базы: вопросы, на которые бот честно отказался
   отвечать, сгруппированные по общим словам. Самые частые
   группы — первые кандидаты в FAQ. «Добавить в базу» открывает
   редактор с готовым разделом под этот вопрос.
   ============================================================ */

const DAYS = [
  { value: 7, label: '7 дней' },
  { value: 30, label: '30 дней' },
  { value: 90, label: '90 дней' },
] as const

export function Gaps() {
  const [days, setDays] = useState<number>(30)
  const { data, error, loading } = useLoad<GapGroup[]>(`/gaps?days=${days}`)

  return (
    <>
      <SectionHead
        title="Пробелы базы"
        lede="Вопросы, на которые в базе не нашлось ответа. Похожие вопросы собраны в группы по общим основам слов. «Близость» — насколько лучший найденный фрагмент был похож на вопрос: чем выше, тем вероятнее, что ответ есть, но сформулирован иначе."
        actions={<Seg label="Период" value={days} options={DAYS} onChange={setDays} />}
      />

      {data && data.length > 0 ? (
        <ul className="gaps" data-loading={loading}>
          {data.map((g, i) => (
            <GapCard key={i} g={g} />
          ))}
        </ul>
      ) : (
        <LoadState loading={loading} error={error} empty="Пробелов нет: за этот период бот нашёл ответ на каждый вопрос." />
      )}
    </>
  )
}

function GapCard({ g }: { g: GapGroup }) {
  const reasons = Object.entries(g.reasons) as [RefusalReason, number][]
  return (
    <li className="card gap">
      <div className="gap__head">
        <span className="gap__count" title="Сколько раз спросили">
          ×{g.count}
        </span>
        <span className="row__tags" title="Общие основы слов: по ним вопросы собраны в группу">
          {g.terms.slice(0, 6).map((t) => (
            <Tag key={t} tone="accent">
              {t}…
            </Tag>
          ))}
        </span>
      </div>

      <ul className="gap__questions">
        {g.questions.map((q) => (
          <li key={q}>«{q}»</li>
        ))}
      </ul>

      <p className="gap__meta muted small">
        {g.locales.map((l) => l.toUpperCase()).join(', ')} · последний {fmtDate(g.lastAt)}
        {g.bestScore !== null && <> · близость {f2(g.bestScore)}</>}
        {reasons.map(([r, n]) => (
          <span key={r}>
            {' '}
            · {REFUSAL_LABEL[r]}: {n}
          </span>
        ))}
      </p>

      <div className="gap__actions">
        <a className="btn btn--primary btn--small" href={href('kb', { add: g.questions[0], locale: g.locales[0] })}>
          Добавить в базу
        </a>
        {g.traceIds.map((id, i) => (
          <a key={id} className="btn btn--quiet btn--small" href={href('traces', { id })}>
            Трасса {i + 1}
          </a>
        ))}
      </div>
    </li>
  )
}
