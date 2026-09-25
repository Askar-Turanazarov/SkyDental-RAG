import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { ModelsInfo, PingResult, ReindexResult } from '../../../shared/admin'
import { IconRetry } from '../../graphics/icons'
import { api, fmtMs } from '../api'
import { LoadState, Notice, SectionHead, Tag, errorText, useLoad } from '../ui'

/* ============================================================
   Модели: цепочка LLM (порядок = приоритет fallback), паузы после
   ошибок, пинг каждой модели, эмбеддинги и переиндексация.
   ============================================================ */

type PingState = PingResult | 'busy' | { error: string }

export function Models() {
  const { data, error, loading, reload } = useLoad<ModelsInfo>('/models')
  const [pings, setPings] = useState<Record<string, PingState>>({})
  const [flash, setFlash] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [reindexing, setReindexing] = useState(false)

  // Пока какая-то модель на паузе — обновляем счётчик сами.
  const anyPaused = data?.chain.some((m) => m.paused) ?? false
  useEffect(() => {
    if (!anyPaused) return
    const t = setInterval(reload, 10_000)
    return () => clearInterval(t)
  }, [anyPaused, reload])

  const ping = async (provider: string, model: string) => {
    const key = `${provider}:${model}`
    setPings((p) => ({ ...p, [key]: 'busy' }))
    try {
      const res = await api<PingResult>('/models/ping', { body: { provider, model } })
      setPings((p) => ({ ...p, [key]: res }))
    } catch (err) {
      setPings((p) => ({ ...p, [key]: { error: errorText(err) } }))
    }
    reload()
  }

  const resetPauses = async () => {
    await api('/models/reset', { body: {} }).catch(() => {})
    setPings({})
    reload()
  }

  const reindex = async () => {
    if (!confirm('Пересчитать индекс всех документов? Эмбеддинги посчитаются заново только для фрагментов, которых ещё нет в индексе этой модели.')) return
    setReindexing(true)
    setFlash(null)
    try {
      const r = await api<ReindexResult>('/reindex', { body: {} })
      setFlash({
        tone: 'good',
        text: `Готово за ${fmtMs(r.ms)}: ${r.documents} док., ${r.total} фрагм. — ${r.embedded} пересчитаны моделью эмбеддингов, ${r.reused} остались как были.`,
      })
    } catch (err) {
      setFlash({ tone: 'bad', text: `Переиндексация не удалась: ${errorText(err)}` })
    } finally {
      setReindexing(false)
      reload()
    }
  }

  if (!data) {
    return (
      <>
        <SectionHead title="Модели" />
        <LoadState loading={loading} error={error} />
      </>
    )
  }

  return (
    <>
      <SectionHead
        title="Модели"
        lede={
          <>
            Цепочка из <code>LLM_CHAIN</code>: запрос идёт первой модели; при 429, 5xx или таймауте — следующей, а упавшая
            модель встаёт на паузу. Ошибка ключа (401/403) выключает провайдера на 10 минут. Порядок меняется в{' '}
            <code>.env</code> без правки кода.
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn--secondary btn--small" onClick={reload}>
              <IconRetry size={16} /> Обновить
            </button>
            <button type="button" className="btn btn--secondary btn--small" onClick={resetPauses} disabled={!anyPaused}>
              Снять паузы
            </button>
          </>
        }
      />

      <section className="card panel">
        <h2 className="panel__title">Цепочка генерации</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Модель</th>
                <th>Состояние</th>
                <th>Пинг</th>
              </tr>
            </thead>
            <tbody>
              {data.chain.map((m, i) => {
                const key = `${m.provider}:${m.model}`
                return (
                  <tr key={key}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <code>{key}</code>
                    </td>
                    <td>
                      <span className="row__tags">
                        {!m.connected ? (
                          <Tag tone="bad" title="В .env нет ключа этого провайдера">
                            нет ключа
                          </Tag>
                        ) : m.paused ? (
                          <Tag tone="warn" title={m.paused.reason}>
                            пауза {m.paused.seconds} с
                          </Tag>
                        ) : (
                          <Tag tone="good">готова</Tag>
                        )}
                        {m.listed === false && (
                          <Tag tone="warn" title="Провайдер не вернул эту модель в списке доступных — её пропускают">
                            нет в списке моделей
                          </Tag>
                        )}
                        {m.paused && <span className="muted small">{m.paused.reason}</span>}
                      </span>
                    </td>
                    <td>
                      <PingCell state={pings[key]} disabled={!m.connected} onPing={() => ping(m.provider, m.model)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <CustomPing providers={data.providers.filter((p) => p.connected).map((p) => p.id)} onPing={ping} pings={pings} />
      </section>

      <div className="grid-2">
        <section className="card panel">
          <h2 className="panel__title">Эмбеддинги и индекс</h2>
          <dl className="facts">
            <dt>Модель</dt>
            <dd>
              <code>{data.embed.label}</code>
            </dd>
            <dt>Документов</dt>
            <dd>{data.embed.documents}</dd>
            <dt>Фрагментов</dt>
            <dd>{data.embed.chunks}</dd>
            <dt>С векторами другой модели</dt>
            <dd>{data.embed.stale ? <Tag tone="warn">{data.embed.stale}</Tag> : 0}</dd>
          </dl>
          {data.embed.needsReindex && (
            <Notice tone="warn">
              Модель эмбеддингов сменилась: векторы вопроса и старых фрагментов несравнимы, поиск по смыслу их не найдёт.
              Нужна переиндексация.
            </Notice>
          )}
          {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
          <button
            type="button"
            className={`btn ${data.embed.needsReindex ? 'btn--primary' : 'btn--secondary'}`}
            disabled={reindexing}
            onClick={reindex}
          >
            {reindexing ? 'Переиндексирую…' : 'Переиндексировать всё'}
          </button>
        </section>

        <section className="card panel">
          <h2 className="panel__title">Поиск и хранилище</h2>
          <dl className="facts">
            <dt>Фрагментов в промпт (top-k)</dt>
            <dd>
              {data.rag.topK} <span className="muted small">RAG_TOP_K</span>
            </dd>
            <dt>Порог близости</dt>
            <dd>
              {data.rag.minScore.toFixed(2)} <span className="muted small">RAG_MIN_SCORE</span>
            </dd>
            <dt>База данных</dt>
            <dd>
              <code>{data.db}</code>
            </dd>
            <dt>Провайдеры с ключом</dt>
            <dd className="row__tags">
              {data.providers.map((p) => (
                <Tag key={p.id} tone={p.connected ? 'good' : 'neutral'}>
                  {p.id}
                </Tag>
              ))}
            </dd>
          </dl>
          <p className="muted small">
            Настройки меняются в <code>.env</code>. Подобрать порог помогает песочница и <code>npm run eval</code>.
          </p>
        </section>
      </div>
    </>
  )
}

function PingCell({ state, disabled, onPing }: { state?: PingState; disabled?: boolean; onPing: () => void }) {
  return (
    <span className="ping">
      <button type="button" className="btn btn--quiet btn--small" disabled={disabled || state === 'busy'} onClick={onPing}>
        {state === 'busy' ? 'Жду ответа…' : 'Пинг'}
      </button>
      {state && state !== 'busy' && <PingResultView state={state} />}
    </span>
  )
}

function PingResultView({ state }: { state: Exclude<PingState, 'busy'> }) {
  if ('error' in state) return <span className="ping__bad">{state.error}</span>
  if (state.ok) {
    return (
      <span className="ping__ok">
        ✓ «{state.text}» · {fmtMs(state.ms)}
      </span>
    )
  }
  const last = state.attempts[state.attempts.length - 1]
  return (
    <span className="ping__bad">
      ✗ {last?.status === 'skipped' ? 'пропущена' : 'ошибка'}
      {last?.detail && `: ${last.detail}`}
    </span>
  )
}

function CustomPing({
  providers,
  pings,
  onPing,
}: {
  providers: string[]
  pings: Record<string, PingState>
  onPing: (provider: string, model: string) => void
}) {
  const [provider, setProvider] = useState(providers[0] ?? '')
  const [model, setModel] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (provider && model.trim()) onPing(provider, model.trim())
  }
  const state = pings[`${provider}:${model.trim()}`]

  return (
    <form className="custom-ping" onSubmit={submit}>
      <p className="muted small">
        Проверить модель вне цепочки — например, перед тем как добавить её в <code>LLM_CHAIN</code>:
      </p>
      <div className="toolbar">
        <select
          className="input input--small"
          aria-label="Провайдер"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          {providers.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <input
          className="input input--small toolbar__grow"
          aria-label="Модель"
          placeholder="например, gemini-3.1-flash-lite"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <button className="btn btn--secondary btn--small" disabled={!provider || !model.trim() || state === 'busy'}>
          {state === 'busy' ? 'Жду ответа…' : 'Пинг'}
        </button>
      </div>
      {state && state !== 'busy' && (
        <p className="small">
          <PingResultView state={state} />
        </p>
      )}
    </form>
  )
}
