import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Dict } from '../../i18n/types'
import { fill } from '../../i18n/fill'
import { IconChevronDown, IconSearchDoc } from '../../graphics/icons'
import type { AnswerMeta, RetrievalInfo } from './ragClient'

/* ============================================================
   «Как я нашёл ответ» — буква R из RAG, выведенная на экран.

   Раскрывашка над ответом: какие фрагменты нашёл поиск, насколько
   каждый близок по смыслу и по словам, какие вошли в промпт,
   прошёл ли лучший фрагмент порог и какая модель в итоге ответила
   (с попытками fallback). В режиме студента раскрыта сразу.

   Компонент не знает про чат: админка показывает им же трассы
   из базы.
   ============================================================ */

interface Props {
  retrieval: RetrievalInfo
  meta?: AnswerMeta
  /** Режим студента: раскрыто по умолчанию, видны тексты кусков и RRF. */
  detailed: boolean
  c: Dict['chat']
}

const f2 = (v: number) => v.toFixed(2)

export function RetrievalTrace({ retrieval, meta, detailed, c }: Props) {
  const tr = c.trace
  const [open, setOpen] = useState(detailed)
  // Переключили режим студента — все трассы следуют за ним.
  useEffect(() => setOpen(detailed), [detailed])

  const { chunks, method, threshold, bestScore } = retrieval
  const hybrid = method === 'hybrid'
  const inPrompt = chunks.filter((ch) => ch.n !== null).length
  // Шкалы у плеч разные: близость векторов — 0…1, оценка полнотекстового
  // поиска — относительная. Полоску «слова» нормируем на лучший кусок.
  const textMax = hybrid ? Math.max(0, ...chunks.map((ch) => ch.textScore ?? 0)) || 1 : 1
  const passed = bestScore !== null && bestScore >= threshold

  return (
    <details className="trace" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="trace__summary">
        <IconSearchDoc size={16} />
        <span className="trace__title">{tr.summary}</span>
        <span className="trace__meta">{fill(tr.summaryMeta, { n: inPrompt, ms: retrieval.ms })}</span>
        <IconChevronDown size={16} className="trace__chevron" />
      </summary>

      <div className="trace__body">
        {retrieval.condensed && (
          <dl className="trace__q">
            <dt>{tr.question}</dt>
            <dd>{retrieval.question}</dd>
            <dt>{tr.condensed}</dt>
            <dd>{retrieval.condensed}</dd>
          </dl>
        )}

        <p className="trace__method">{hybrid ? tr.methodHybrid : tr.methodKeyword}</p>

        {chunks.length > 0 && (
          <ol className="trace__chunks">
            {chunks.map((ch) => (
              <li key={ch.chunkId} className="trace__chunk" data-in={ch.n !== null}>
                <div className="trace__row">
                  <span className="trace__n" aria-hidden={ch.n === null}>
                    {ch.n ?? '·'}
                  </span>
                  <span className="trace__src">{ch.source}</span>
                  <span className="trace__lang">{ch.locale.toUpperCase()}</span>
                  <span className="trace__badge">{ch.n !== null ? tr.inPrompt : tr.notInPrompt}</span>
                </div>
                <div className="trace__bars">
                  {hybrid && <Bar kind="vec" label={tr.semantic} value={ch.vecScore} max={1} tick={threshold} />}
                  <Bar kind="text" label={tr.keyword} value={ch.textScore} max={textMax} />
                  {detailed && hybrid && <span className="trace__rrf">RRF {ch.rrf.toFixed(4)}</span>}
                </div>
                {detailed && <p className="trace__text">{ch.text}</p>}
              </li>
            ))}
          </ol>
        )}

        {hybrid && bestScore !== null && (
          <p className="trace__threshold" data-ok={passed}>
            {fill(tr.threshold, { threshold: f2(threshold), best: f2(bestScore) })}
            {' — '}
            <strong>{passed ? tr.passed : tr.failed}</strong>
          </p>
        )}

        {retrieval.schedule && (
          <div className="trace__schedule">
            <p>{fill(tr.schedule, { doctors: retrieval.schedule.doctors, slots: retrieval.schedule.slots })}</p>
            {detailed && <pre className="trace__text">{retrieval.schedule.text}</pre>}
          </div>
        )}

        {meta && <ModelInfo meta={meta} c={c} />}

        {!hybrid && <p className="trace__note">{tr.demoNote}</p>}
      </div>
    </details>
  )
}

interface BarProps {
  /** vec — близость по смыслу, text — совпадение слов: разные цвета полосок. */
  kind: 'vec' | 'text'
  label: string
  value: number | null
  max: number
  /** Засечка порога на шкале. */
  tick?: number
}

function Bar({ kind, label, value, max, tick }: BarProps) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value / max)) * 100
  return (
    <span className="bar" data-kind={kind} data-empty={value === null}>
      <span className="bar__label">{label}</span>
      <span className="bar__track" style={{ '--v': `${pct}%` } as CSSProperties}>
        <span className="bar__fill" />
        {tick !== undefined && <span className="bar__tick" style={{ left: `${tick * 100}%` }} />}
      </span>
      <span className="bar__value">{value === null ? '—' : f2(value)}</span>
    </span>
  )
}

function ModelInfo({ meta, c }: { meta: AnswerMeta; c: Dict['chat'] }) {
  const tr = c.trace
  const { attempts, usage, timings } = meta
  // Попытки показываем, только если было что-то интереснее «первая модель ответила».
  const showAttempts = attempts.length > 1 || attempts.some((a) => a.status !== 'ok')
  const statusText = { ok: tr.attemptOk, error: tr.attemptError, skipped: tr.attemptSkipped }

  return (
    <div className="trace__model">
      {meta.model && (
        <p>
          <span className="trace__k">{tr.model}:</span> <code>{meta.model}</code>
          {meta.provider && <span className="trace__dim"> · {meta.provider}</span>}
          {usage && (usage.inputTokens || usage.outputTokens) ? (
            <span className="trace__dim">
              {' '}
              · {tr.tokens} {usage.inputTokens ?? '?'} → {usage.outputTokens ?? '?'}
            </span>
          ) : null}
        </p>
      )}
      {showAttempts && (
        <div>
          <span className="trace__k">{tr.attempts}:</span>
          <ol className="trace__attempts">
            {attempts.map((a, i) => (
              <li key={i} data-status={a.status}>
                <code>
                  {a.provider}:{a.model}
                </code>{' '}
                — {statusText[a.status]}
                {a.detail && <span className="trace__dim"> ({a.detail})</span>}
                {a.status !== 'skipped' && <span className="trace__dim"> · {a.ms} {tr.ms}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="trace__dim">
        {fill(tr.timing, { retrieve: timings.retrieveMs, generate: timings.generateMs })}
      </p>
    </div>
  )
}
