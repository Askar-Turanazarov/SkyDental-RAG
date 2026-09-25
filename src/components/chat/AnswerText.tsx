import type { ReactNode } from 'react'
import type { RetrievedChunk } from './ragClient'

/* ============================================================
   Текст ответа со сносками. Модель ставит [n] после утверждений —
   здесь каждая сноска становится кнопкой: нажали → под ответом
   раскрывается цитата того самого фрагмента базы, на который
   опиралась модель. Так видно, что ответ не выдуман.
   ============================================================ */

const TOKENS = /(\*\*[^*\n]+\*\*|\[\d+\])/g

interface Props {
  text: string
  /** Куски из события retrieval: по номеру [n] находим цитату. */
  chunks: RetrievedChunk[]
  active: number | null
  onCite: (n: number) => void
  citeLabel: (n: number, source: string) => string
}

export function AnswerText({ text, chunks, active, onCite, citeLabel }: Props) {
  const byN = new Map(chunks.filter((c) => c.n !== null).map((c) => [c.n!, c]))

  const inline = (line: string, key: string): ReactNode[] =>
    line.split(TOKENS).map((part, i) => {
      const k = `${key}-${i}`
      const cite = /^\[(\d+)\]$/.exec(part)
      if (cite) {
        const n = Number(cite[1])
        const chunk = byN.get(n)
        // Номер, которого не было в промпте, оставляем как есть.
        if (!chunk) return part
        return (
          <button
            key={k}
            type="button"
            className="cite"
            aria-pressed={active === n}
            aria-label={citeLabel(n, chunk.source)}
            onClick={() => onCite(n)}
          >
            {n}
          </button>
        )
      }
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return <strong key={k}>{part.slice(2, -2)}</strong>
      }
      return part
    })

  return (
    <>
      {text
        .trim()
        .split(/\n{2,}/)
        .map((para, i) => (
          <p key={i}>
            {para.split('\n').map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(line, `${i}-${j}`)}
              </span>
            ))}
          </p>
        ))}
    </>
  )
}

/** Цитата фрагмента, раскрытая по нажатию на сноску или на чип источника. */
export function CiteCard({ chunk }: { chunk: RetrievedChunk }) {
  return (
    <figure className="cite-card">
      <figcaption className="cite-card__head">
        <span className="cite-card__n">{chunk.n}</span>
        <span className="cite-card__src">{chunk.source}</span>
      </figcaption>
      <blockquote className="cite-card__text">{chunk.text}</blockquote>
    </figure>
  )
}
