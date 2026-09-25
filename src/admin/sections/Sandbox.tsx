import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ModelsInfo, SandboxResult } from '../../../shared/admin'
import type { Locale } from '../../../shared/protocol'
import { ru } from '../../i18n/ru'
import { RetrievalTrace } from '../../components/chat/RetrievalTrace'
import { api } from '../api'
import { Notice, SectionHead, Seg, Tag, errorText, f2, useLoad } from '../ui'

/* ============================================================
   Песочница: только буква R из RAG. Вопрос → поиск → промпт,
   без вызова модели (ключи не тратятся). Ползунки top-k и порога
   показывают, как настройки меняют решение «отвечать или отказать».
   ============================================================ */

const SHOW_LIMIT = 8

const EXAMPLES: { q: string; locale: Locale }[] = [
  { q: 'Сколько стоит имплант?', locale: 'ru' },
  { q: 'Вы работаете в воскресенье?', locale: 'ru' },
  { q: 'Болит зуб ночью, что делать?', locale: 'ru' },
  { q: 'Implant qancha turadi?', locale: 'uz' },
  { q: 'Какая завтра погода в Ташкенте?', locale: 'ru' },
]

const LOCALES = [
  { value: 'ru', label: 'RU' },
  { value: 'uz', label: 'UZ' },
] as const

export function Sandbox() {
  const models = useLoad<ModelsInfo>('/models')
  const [question, setQuestion] = useState('')
  const [locale, setLocale] = useState<Locale>('ru')
  const [topK, setTopK] = useState<number | null>(null)
  const [threshold, setThreshold] = useState<number | null>(null)
  const [result, setResult] = useState<SandboxResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const asked = useRef<{ question: string; locale: Locale } | null>(null)

  const k = topK ?? models.data?.rag.topK ?? 5
  const thr = threshold ?? result?.retrieval.threshold ?? models.data?.rag.minScore ?? 0.6

  const search = async (q: string, loc: Locale, top: number) => {
    asked.current = { question: q, locale: loc }
    setBusy(true)
    setError(null)
    try {
      setResult(await api<SandboxResult>('/sandbox', { body: { question: q, locale: loc, topK: top } }))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  // Двигаем top-k — поиск повторяется для того же вопроса.
  useEffect(() => {
    const last = asked.current
    if (!last || topK === null) return
    const t = setTimeout(() => search(last.question, last.locale, topK), 250)
    return () => clearTimeout(t)
  }, [topK])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (question.trim()) search(question.trim(), locale, k)
  }

  const r = result?.retrieval
  const verdict = r && (!r.chunks.length ? 'no-chunks' : r.bestScore === null || r.bestScore < thr ? 'below-threshold' : null)

  return (
    <>
      <SectionHead
        title="Песочница поиска"
        lede="Задайте вопрос и посмотрите, что найдёт поиск и какой промпт получит модель. Генерации нет — ключи LLM не тратятся, нужен только ключ эмбеддингов."
      />

      <form className="card panel sandbox" onSubmit={submit}>
        <div className="toolbar">
          <input
            className="input toolbar__grow"
            placeholder="Вопрос как от пациента"
            aria-label="Вопрос"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Seg label="Язык ответа" value={locale} options={LOCALES} onChange={setLocale} />
          <button className="btn btn--primary" disabled={busy || !question.trim()}>
            {busy ? 'Ищу…' : 'Искать'}
          </button>
        </div>
        <p className="row__tags">
          <span className="muted small">Примеры:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.q}
              type="button"
              className="chip"
              onClick={() => {
                setQuestion(ex.q)
                setLocale(ex.locale)
                search(ex.q, ex.locale, k)
              }}
            >
              {ex.q}
            </button>
          ))}
        </p>

        <div className="sliders">
          <label className="slider">
            <span className="slider__label">
              Фрагментов в промпт (top-k): <strong>{k}</strong>
            </span>
            <input type="range" min={1} max={SHOW_LIMIT} step={1} value={k} onChange={(e) => setTopK(Number(e.target.value))} />
          </label>
          <label className="slider">
            <span className="slider__label">
              Порог близости: <strong>{f2(thr)}</strong>
              {threshold !== null && r && threshold !== r.threshold && (
                <button type="button" className="btn btn--quiet btn--small" onClick={() => setThreshold(null)}>
                  вернуть {f2(r.threshold)}
                </button>
              )}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={thr}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="muted small">
          Порог двигается только здесь, в браузере — чтобы увидеть, где проходит граница. На бота влияет{' '}
          <code>RAG_MIN_SCORE</code> в <code>.env</code>.
        </p>
      </form>

      {error && <Notice tone="bad">{error}</Notice>}

      {result && r && (
        <div className="stack" data-loading={busy}>
          <Notice tone={verdict ? 'warn' : 'good'}>
            {verdict === 'no-chunks' ? (
              <>Поиск не нашёл ни одного фрагмента — бот откажется, не вызывая модель.</>
            ) : verdict === 'below-threshold' ? (
              <>
                Лучшая близость {f2(r.bestScore)} ниже порога {f2(thr)} — бот честно откажется, модель не вызывается.
              </>
            ) : (
              <>
                Лучшая близость {f2(r.bestScore)} ≥ порога {f2(thr)} — вопрос уйдёт модели вместе с{' '}
                {r.chunks.filter((c) => c.n !== null).length} фрагм. Если ответа в них нет, модель вернёт{' '}
                <code>NO_ANSWER</code>.
              </>
            )}
          </Notice>

          <RetrievalTrace retrieval={{ ...r, threshold: thr }} detailed c={ru.chat} />

          <details className="card panel prompt">
            <summary className="prompt__summary">
              Промпт, который получит модель{' '}
              <Tag>{(result.prompt.system.length + result.prompt.user.length).toLocaleString('ru-RU')} симв.</Tag>
            </summary>
            <h3 className="prompt__label">system</h3>
            <pre className="code-view">{result.prompt.system}</pre>
            <h3 className="prompt__label">user</h3>
            <pre className="code-view">{result.prompt.user}</pre>
          </details>
        </div>
      )}
    </>
  )
}
