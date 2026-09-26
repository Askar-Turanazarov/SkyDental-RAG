import { readFile, writeFile } from 'node:fs/promises'
import { ANSWER_KINDS, NO_ANSWER } from '../shared/protocol.js'
import type { AnswerKind, ChatTurn, Locale, RetrievedChunk } from '../shared/protocol.js'
import { getDb } from '../server/db/client.js'
import { env } from '../server/env.js'
import { generateText } from '../server/llm/chain.js'
import { chain, embedModelLabel, parseChain } from '../server/llm/registry.js'
import type { ChainEntry } from '../server/llm/registry.js'
import type { GenerateRequest } from '../server/llm/types.js'
import { condenseQuestion, realChain } from '../server/rag/answer.js'
import { formatContext, parseKindTag, ragRequest } from '../server/rag/prompt.js'
import { SHOW_LIMIT, retrieve } from '../server/rag/retrieve.js'

/* ============================================================
   EVAL: насколько хорошо бот находит ответы в базе.

   npm run eval               — только поиск, ответы не генерируются:
                                hit@k, MRR, отказы по порогу, подбор
                                RAG_MIN_SCORE;
   npm run eval -- --judge    — ещё полный ответ модели и оценка
                                LLM-судьи: верно ли по базе, по делу ли;
   npm run eval -- --judge=gemini:gemini-3.5-flash
                              — судья не из LLM_CHAIN, а заданный.

   Эталон — eval/golden.json, отчёт — eval/report.md. Поиск идёт
   в той же базе и той же моделью эмбеддингов, что у сервера
   (DATABASE_URL, EMBED_*), поэтому сначала npm run seed.

   Термины:
   - hit@k — доля вопросов, где нужный фрагмент нашёлся среди первых k;
     hit@RAG_TOP_K — «правильный фрагмент попал в промпт»;
   - MRR — среднее 1/место нужного фрагмента: 1 — всегда первый,
     0.5 — в среднем второй;
   - близость — косинус лучшего фрагмента в векторном поиске, её
     и сравнивают с порогом RAG_MIN_SCORE.
   ============================================================ */

/** Цель из плана: правильный фрагмент в промпте у 90% вопросов. */
const TARGET = 0.9

type Group = 'ru' | 'uz' | 'cross' | 'followup' | 'out'
const GROUPS: Record<Group, string> = {
  ru: 'RU, прямые',
  uz: 'UZ, прямые',
  cross: 'Не на языке сайта',
  followup: 'Уточнения с историей',
  out: 'Вне базы',
}

interface GoldenCase {
  id: string
  group: Group
  locale: Locale
  question: string
  history?: ChatTurn[]
  /** Темы из topics: любая из них — попадание. */
  expect?: string[]
  expectRefusal?: boolean
  /** Какие метки вида ответа допустимы (проверяется с --judge). */
  expectKind?: AnswerKind[]
}

interface Golden {
  topics: Record<string, string[]>
  cases: GoldenCase[]
}

interface Judged {
  /**
   * Чем кончилось: answered — ответ по базе (kb); declined — без фактов
   * из базы (общая справка, «нет данных», не по теме, приветствие или
   * NO_ANSWER офлайн-модели); threshold — офлайн-отказ без модели; error — сбой.
   */
  outcome: 'threshold' | 'declined' | 'answered' | 'error'
  /** Метка вида ответа, которую поставила модель. */
  kind: AnswerKind | null
  answer: string
  model: string | null
  /** Оценки судьи — только для outcome 'answered'; null — судья не ответил. */
  faithful: boolean | null
  relevant: boolean | null
  comment: string
}

interface Result {
  c: GoldenCase
  condensed: string | null
  chunks: RetrievedChunk[]
  bestScore: number | null
  /** Место первого подходящего фрагмента (1…SHOW_LIMIT); null — не нашёлся. */
  rank: number | null
  judged?: Judged
}

/* ---------- Запуск ---------- */

const judgeArg = process.argv.slice(2).find((a) => a === '--judge' || a.startsWith('--judge='))
const golden = JSON.parse(await readFile(new URL('../eval/golden.json', import.meta.url), 'utf8')) as Golden
checkGolden(golden)
const driver = await preflight(golden)

let judgeChain: ChainEntry[] | null = null
if (judgeArg) {
  judgeChain = judgeArg.includes('=') ? parseChain(judgeArg.slice('--judge='.length)) : realChain
  if (!judgeChain.length) {
    console.warn('⚠ Судья пропущен: в цепочке нет настоящей модели (нужен GEMINI_API_KEY или ключ другого провайдера).')
    judgeChain = null
  }
}

console.log(
  `Eval: ${golden.cases.length} вопросов · ${embedModelLabel} · top-k ${env.RAG_TOP_K} · порог ${env.RAG_MIN_SCORE}` +
    (judgeChain ? ' · с судьёй' : ''),
)

const results: Result[] = []
for (const c of golden.cases) {
  const condensed = c.history?.length ? await condenseQuestion(c.question, c.history) : null
  const r = await retrieve(condensed ?? c.question, c.locale)
  const accepted = new Set((c.expect ?? []).flatMap((t) => golden.topics[t]))
  const at = r.chunks.findIndex((ch) => accepted.has(ch.source))
  const res: Result = { c, condensed, chunks: r.chunks, bestScore: r.bestScore, rank: at < 0 ? null : at + 1 }
  if (judgeChain) res.judged = await judge(res, judgeChain)
  results.push(res)
  if (process.stdout.isTTY) process.stdout.write(`\r  ${results.length}/${golden.cases.length}`)
}
if (process.stdout.isTTY) process.stdout.write('\r\x1b[K')

const { console: summary, file } = buildReport(results)
await writeFile(new URL('../eval/report.md', import.meta.url), file)
console.log(summary)
console.log('\nПолный отчёт: eval/report.md')
process.exit(0)

/* ---------- Проверки до запуска ---------- */

function checkGolden(g: Golden) {
  const ids = new Set<string>()
  for (const c of g.cases) {
    if (ids.has(c.id)) throw new Error(`golden.json: id ${c.id} повторяется`)
    ids.add(c.id)
    if (!c.expectRefusal && !c.expect?.length) throw new Error(`golden.json: у ${c.id} нет ни expect, ни expectRefusal`)
    for (const t of c.expect ?? []) if (!g.topics[t]) throw new Error(`golden.json: у ${c.id} неизвестная тема ${t}`)
    for (const k of c.expectKind ?? []) {
      if (!ANSWER_KINDS.includes(k)) throw new Error(`golden.json: у ${c.id} неизвестный вид ответа ${k}`)
    }
  }
}

async function preflight(g: Golden) {
  const db = await getDb()
  const [count] = await db.query<{ ok: number; total: number }>(
    'select count(*) filter (where embed_model = $1)::int as ok, count(*)::int as total from chunks',
    [embedModelLabel],
  )
  if (!count.ok) {
    console.error(
      `В базе нет фрагментов с эмбеддингами ${embedModelLabel}. Запустите npm run seed с теми же ` +
        'EMBED_PROVIDER и EMBED_MODEL или нажмите «Переиндексировать всё» в админке.',
    )
    process.exit(1)
  }
  if (count.ok < count.total) {
    console.warn(`⚠ ${count.total - count.ok} фрагм. проиндексированы другой моделью: векторный поиск их не видит.`)
  }

  // Подписи берутся из заголовков документа. Переименовали раздел
  // в админке — эталон надо поправить, иначе будут ложные промахи.
  const labels = new Set((await db.query<{ source_label: string }>('select distinct source_label from chunks')).map((r) => r.source_label))
  for (const [topic, variants] of Object.entries(g.topics)) {
    for (const label of variants) {
      if (!labels.has(label)) console.warn(`⚠ Тема ${topic}: в базе нет фрагмента «${label}» — поправьте eval/golden.json.`)
    }
  }
  return db.driver
}

/* ---------- Полный ответ и судья ---------- */

/** Откажет ли бот при пороге t — так же, как шаг threshold в answer.ts. */
function refusedAt(r: Result, t: number): boolean {
  return !r.chunks.length || r.bestScore === null || r.bestScore < t
}

async function judge(r: Result, judgeChain: ChainEntry[]): Promise<Judged> {
  const question = r.condensed ?? r.c.question
  const out: Judged = { outcome: 'threshold', kind: null, answer: '', model: null, faithful: null, relevant: null, comment: '' }
  // Как в answer.ts: порог не пройден — фрагменты в промпт не идут,
  // но настоящая модель всё равно отвечает (общая справка, «нет данных»…).
  const below = refusedAt(r, env.RAG_MIN_SCORE)
  const chunks = below ? r.chunks.map((ch) => ({ ...ch, n: null })) : r.chunks
  if (below && !realChain.length) return out

  try {
    const res = await generateText(
      ragRequest({
        question: r.c.question,
        locale: r.c.locale,
        history: r.c.history ?? [],
        chunks,
        bestScore: r.bestScore,
        threshold: env.RAG_MIN_SCORE,
      }),
    )
    const tag = parseKindTag(res.text)
    out.answer = tag.rest.trim()
    out.kind = tag.kind ?? (/\[\d+\]/.test(out.answer) ? 'kb' : null)
    out.model = `${res.provider}:${res.model}`
  } catch (err) {
    return { ...out, outcome: 'error', comment: `модели не ответили: ${(err as Error).message}` }
  }
  if (!out.answer || out.answer.startsWith(NO_ANSWER) || out.kind !== 'kb') return { ...out, outcome: 'declined' }
  out.outcome = 'answered'

  try {
    const res = await generateText(judgeRequest(question, formatContext(chunks), out.answer), judgeChain)
    const json = res.text.match(/\{[\s\S]*\}/)?.[0]
    if (!json) throw new Error('вернул не JSON')
    const v = JSON.parse(json) as Record<string, unknown>
    out.faithful = v.faithful === true
    out.relevant = v.relevant === true
    out.comment = typeof v.comment === 'string' ? v.comment : ''
  } catch (err) {
    out.comment = `нет оценки судьи: ${(err as Error).message}`
  }
  return out
}

function judgeRequest(question: string, context: string, answer: string): GenerateRequest {
  return {
    system: [
      'You grade answers of a dental clinic support bot. The bot must answer only from the knowledge base fragments it was given.',
      'Reply with JSON only, no markdown: {"faithful": true|false, "relevant": true|false, "comment": "..."}',
      'faithful: every fact in the answer (prices, hours, numbers, conditions) is stated in the fragments. Citation markers like [1] are expected.',
      'relevant: the answer addresses what the client asked.',
      'comment: one short sentence in Russian about the main problem, or an empty string if both are true.',
    ].join('\n'),
    messages: [{ role: 'user', text: `Fragments:\n${context}\n\nClient question: ${question}\n\nBot answer:\n${answer}` }],
    temperature: 0,
    maxTokens: 200,
  }
}

/* ---------- Отчёт ---------- */

function buildReport(results: Result[]) {
  const k = env.RAG_TOP_K
  const answerable = results.filter((r) => !r.c.expectRefusal)
  const outside = results.filter((r) => r.c.expectRefusal)
  const inPrompt = (r: Result) => r.rank !== null && r.rank <= k

  // Консоль получает сводку, файл — сводку и подробности, в том же порядке.
  const con: string[] = []
  const md: string[] = []
  const both = (...lines: string[]) => {
    con.push(...lines)
    md.push(...lines)
  }
  const fileOnly = (...lines: string[]) => md.push(...lines)

  /* Шапка */
  both(
    '# Eval RAG · SkyDental',
    '',
    `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · база \`${driver}\` · эмбеддинги \`${embedModelLabel}\` · ` +
      `LLM_CHAIN \`${chain.map((e) => `${e.provider}:${e.model}`).join(',')}\` · RAG_TOP_K ${k} · RAG_MIN_SCORE ${env.RAG_MIN_SCORE}`,
  )
  if (embedModelLabel.startsWith('local:')) {
    both(
      '',
      `> Эмбеддинги офлайн-заглушки \`${embedModelLabel}\` — это хеш слов, а не смысл: вопросы другими словами ` +
        'и на другом языке она не находит. Настоящие цифры — с `GEMINI_API_KEY` и `EMBED_PROVIDER=gemini` после `npm run seed`.',
    )
  }
  if (!realChain.length && answerable.some((r) => r.c.history?.length)) {
    both('', '> Уточнения искались по исходному вопросу: для шага condense в цепочке нет настоящей модели.')
  }

  /* Поиск */
  const hitK = answerable.filter(inPrompt).length / answerable.length
  const groupRows = (['ru', 'uz', 'cross', 'followup'] as Group[])
    .map((g) => [GROUPS[g], answerable.filter((r) => r.c.group === g)] as const)
    .filter(([, rs]) => rs.length)
  both(
    '',
    `## Поиск: ${answerable.length} вопросов с ответом в базе`,
    '',
    table(
      ['Группа', 'Вопросов', 'hit@1', 'hit@3', `hit@${k} (в промпте)`, `hit@${SHOW_LIMIT} (в трассе)`, 'MRR'],
      [retrievalRow('**Все**', answerable), ...groupRows.map(([label, rs]) => retrievalRow(label, rs))],
    ),
    '',
    `Цель — hit@${k} ≥ ${pct(TARGET)}: ${pct(hitK)} ${hitK >= TARGET ? '✓ достигнута' : '✗ не достигнута'}.`,
  )

  /* Отказы при текущем пороге */
  const t = env.RAG_MIN_SCORE
  const rightRefusals = outside.filter((r) => refusedAt(r, t))
  const wrongRefusals = answerable.filter((r) => refusedAt(r, t))
  both(
    '',
    `## Отказы по порогу ${t}`,
    '',
    `- Вопросы вне базы, на которые бот откажет, не вызывая модель: ${of(rightRefusals.length, outside.length)}.`,
    `- Вопросы из базы, на которые бот откажет зря: ${of(wrongRefusals.length, answerable.length)}.`,
  )
  if (outside.length > rightRefusals.length) {
    both(
      '- Остальные вопросы вне базы уйдут к модели с фрагментами — она должна понять, что ответа в них нет (проверяет `--judge`).',
    )
  }

  /* Подбор порога */
  const sw = sweep(answerable, outside)
  if (sw) {
    const scoresIn = sorted(answerable)
    const scoresOut = sorted(outside)
    const minIn = scoresIn[0]
    const maxOut = scoresOut[scoresOut.length - 1]
    both(
      '',
      '## Подбор RAG_MIN_SCORE',
      '',
      `Близость лучшего фрагмента: вопросы из базы — ${f2(minIn)}…${f2(scoresIn[scoresIn.length - 1])} ` +
        `(медиана ${f2(median(scoresIn))}), вне базы — ${f2(scoresOut[0])}…${f2(maxOut)} (медиана ${f2(median(scoresOut))}).`,
      '',
      minIn > maxOut
        ? `Группы не пересекаются: любой порог выше ${f2(maxOut)} и не выше ${f2(minIn)} разделяет их без ошибок.`
        : `Группы пересекаются: ${answerable.filter((r) => (r.bestScore ?? 0) <= maxOut).length} вопр. из базы ` +
            `не «увереннее» самого близкого вопроса вне базы (${f2(maxOut)}). Одним порогом их не разделить — ` +
            'часть отказов остаётся за моделью.',
      '',
      `Рекомендуемый порог: **${sw.recommended.toFixed(2)}** — в среднем ${pct(sw.best)} верных решений ` +
        `«отвечать / отказать»${sw.from < sw.to ? ` (так же хорош любой от ${sw.from.toFixed(2)} до ${sw.to.toFixed(2)})` : ''}. ` +
        `Сейчас: ${t}.`,
    )
    fileOnly('', sweepTable(sw, t))
  }

  /* Промахи */
  const missed = answerable.filter((r) => !inPrompt(r))
  const leaked = outside.filter((r) => !refusedAt(r, t))
  if (missed.length || wrongRefusals.length || leaked.length) {
    both('', '## Что разобрать', '')
    for (const r of missed) {
      both(
        `- ${caseTitle(r)}: ждали «${expectLabel(r)}», ` +
          `${r.rank ? `нашёлся на ${r.rank}-м месте — за пределами промпта` : `среди первых ${SHOW_LIMIT} нет`}; ` +
          `первым — «${r.chunks[0]?.source ?? '—'}» (${f2(r.bestScore)}).`,
      )
    }
    for (const r of wrongRefusals.filter(inPrompt)) {
      both(`- ${caseTitle(r)}: фрагмент найден, но близость ${f2(r.bestScore)} ниже порога — бот откажет зря.`)
    }
    for (const r of leaked) {
      both(`- ${caseTitle(r)}: вне базы, но близость ${f2(r.bestScore)} ≥ порога; первым — «${r.chunks[0]?.source ?? '—'}».`)
    }
  }

  /* Судья */
  const judged = results.filter((r) => r.judged)
  if (judged.length) {
    const [short, details] = judgeSection(answerable, outside)
    both('', ...short)
    fileOnly('', ...details)
  }

  /* Все вопросы — только в файле */
  fileOnly(
    '',
    '## Все вопросы',
    '',
    table(
      ['id', 'Группа', 'Вопрос', 'Ожидали', 'Место', 'Близость', 'Первым найдено'],
      results.map((r) => [
        `\`${r.c.id}\``,
        GROUPS[r.c.group],
        r.condensed ? `${r.c.question} → _${r.condensed}_` : r.c.question,
        r.c.expectRefusal ? 'отказ' : expectLabel(r),
        r.c.expectRefusal
          ? refusedAt(r, t) ? 'отказ ✓' : 'к модели'
          : r.rank === null ? '✗' : `${r.rank}${r.rank <= k ? ' ✓' : ''}`,
        f2(r.bestScore),
        r.chunks[0]?.source ?? '—',
      ]),
    ),
  )

  return {
    console: con.join('\n'),
    file: md.join('\n') + '\n',
  }
}

function retrievalRow(label: string, rs: Result[]) {
  const hit = (n: number) => pct(rs.filter((r) => r.rank !== null && r.rank <= n).length / rs.length)
  const mrr = rs.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / rs.length
  return [label, rs.length, hit(1), hit(3), hit(env.RAG_TOP_K), hit(SHOW_LIMIT), mrr.toFixed(2)]
}

interface Sweep {
  rows: { t: number; keep: number; reject: number; score: number }[]
  best: number
  from: number
  to: number
  recommended: number
}

/**
 * Перебор порогов 0.00…1.00. Для каждого: какая доля вопросов из базы
 * дойдёт до модели и какая доля вопросов вне базы получит отказ.
 * Лучший порог — с максимумом их среднего.
 */
function sweep(answerable: Result[], outside: Result[]): Sweep | null {
  if (!answerable.length || !outside.length) return null
  const rows = Array.from({ length: 101 }, (_, i) => {
    const t = i / 100
    const keep = answerable.filter((r) => !refusedAt(r, t)).length / answerable.length
    const reject = outside.filter((r) => refusedAt(r, t)).length / outside.length
    return { t, keep, reject, score: (keep + reject) / 2 }
  })
  const best = Math.max(...rows.map((r) => r.score))
  // Лучших порогов обычно целый отрезок. Берём середину самого
  // длинного: так запас есть в обе стороны.
  let from = 0
  let to = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].score !== best) continue
    let j = i
    while (j + 1 < rows.length && rows[j + 1].score === best) j++
    if (j - i > to - from) [from, to] = [i, j]
    i = j
  }
  return { rows, best, from: rows[from].t, to: rows[to].t, recommended: rows[Math.round((from + to) / 2)].t }
}

function sweepTable(sw: Sweep, current: number): string {
  // Шаг 0.05 плюс текущий и рекомендуемый пороги; края — где что-то меняется.
  const changes = sw.rows.filter((r, i) => i > 0 && r.score !== sw.rows[i - 1].score).map((r) => r.t)
  const lo = Math.max(0, (changes[0] ?? 0) - 0.1)
  const hi = Math.min(1, (changes[changes.length - 1] ?? 1) + 0.1)
  const cur = Math.round(current * 100)
  const rec = Math.round(sw.recommended * 100)
  const picked = sw.rows.filter((_, i) => i === cur || i === rec || (i % 5 === 0 && i / 100 >= lo && i / 100 <= hi))
  return table(
    ['Порог', 'Дойдут до модели (из базы)', 'Отказ (вне базы)', 'Среднее', ''],
    picked.map((r) => {
      const i = Math.round(r.t * 100)
      const mark = [i === cur && 'сейчас', i === rec && 'рекомендуем'].filter(Boolean).join(', ')
      return [r.t.toFixed(2), pct(r.keep), pct(r.reject), pct(r.score), mark ? `← ${mark}` : '']
    }),
  )
}

function judgeSection(answerable: Result[], outside: Result[]): [string[], string[]] {
  const models = [...new Set([...answerable, ...outside].map((r) => r.judged?.model).filter(Boolean))]
  const row = (label: string, rs: Result[]) => {
    const j = rs.map((r) => r.judged!)
    const n = (o: Judged['outcome']) => j.filter((x) => x.outcome === o).length
    const graded = j.filter((x) => x.outcome === 'answered' && x.faithful !== null)
    const share = (key: 'faithful' | 'relevant') => (graded.length ? of(graded.filter((x) => x[key]).length, graded.length) : '—')
    return [label, rs.length, n('answered'), n('threshold'), n('declined'), n('error'), share('faithful'), share('relevant')]
  }
  const refusedOutside = outside.filter((r) => r.judged!.outcome === 'threshold' || r.judged!.outcome === 'declined')
  const refusedInside = answerable.filter((r) => r.judged!.outcome === 'threshold' || r.judged!.outcome === 'declined')

  const short = [
    '## Полный ответ и судья',
    '',
    `Отвечали: ${models.map((m) => `\`${m}\``).join(', ') || '—'}. Судья видит те же фрагменты и проверяет каждое утверждение ответа.`,
    '',
    table(
      ['', 'Вопросов', 'Ответ по базе', 'Офлайн-отказ', 'Без фактов из базы', 'Сбой', 'Верно по базе', 'По делу'],
      [row('Из базы', answerable), row('Вне базы', outside)],
    ),
    '',
    `- Вне базы бот отказался (порог + модель): ${of(refusedOutside.length, outside.length)}.`,
    `- Из базы отказался зря: ${of(refusedInside.length, answerable.length)}.`,
    ...kindLine([...answerable, ...outside]),
  ]

  const problems = [
    ...new Set([
      ...answerable.filter((r) => r.judged!.outcome === 'answered' && (r.judged!.faithful === false || r.judged!.relevant === false)),
      ...outside.filter((r) => r.judged!.outcome === 'answered'),
      ...[...answerable, ...outside].filter((r) => r.judged!.outcome === 'error' || (r.judged!.outcome === 'answered' && r.judged!.faithful === null)),
      ...[...answerable, ...outside].filter((r) => !kindMatches(r)),
    ]),
  ]
  const details = problems.length
    ? [
        '### Ответы, которые стоит прочитать',
        '',
        ...problems.map((r) => {
          const j = r.judged!
          const verdict = !kindMatches(r)
            ? `вид ответа ${j.kind ?? 'без метки'}, ждали ${r.c.expectKind!.join(' / ')}`
            : r.c.expectRefusal && j.outcome === 'answered'
              ? 'ответил по базе, хотя ответа в ней нет'
              : j.comment || 'см. ответ'
          return `- ${caseTitle(r)} — ${verdict}${j.answer ? `\n  > ${clip(j.answer, 300)}` : ''}`
        }),
      ]
    : []
  return [short, details]
}

/** Совпал ли вид ответа с ожидаемым (нет expectKind — не проверяем). */
function kindMatches(r: Result): boolean {
  const want = r.c.expectKind
  if (!want?.length || !r.judged || r.judged.outcome === 'error' || r.judged.outcome === 'threshold') return true
  return r.judged.kind !== null && want.includes(r.judged.kind)
}

function kindLine(rs: Result[]): string[] {
  const checked = rs.filter((r) => r.c.expectKind?.length && r.judged && r.judged.outcome !== 'error' && r.judged.outcome !== 'threshold')
  if (!checked.length) return []
  const wrong = checked.filter((r) => !kindMatches(r)).map((r) => `\`${r.c.id}\` (${r.judged!.kind ?? 'без метки'})`)
  const tail = wrong.length ? ` — мимо: ${wrong.join(', ')}.` : '.'
  return [`- Вид ответа (приветствие, не по теме, общая справка, по базе) совпал: ${of(checked.length - wrong.length, checked.length)}${tail}`]
}

/* ---------- Мелочи ---------- */

function table(head: (string | number)[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`
  return [line(head), `|${head.map(() => '---').join('|')}|`, ...rows.map(line)].join('\n')
}

function caseTitle(r: Result): string {
  return `\`${r.c.id}\` «${r.c.question}»${r.condensed ? ` → «${r.condensed}»` : ''}`
}

/** Подпись ожидаемого источника на языке вопроса. */
function expectLabel(r: Result): string {
  return (r.c.expect ?? []).map((t) => golden.topics[t][r.c.locale === 'uz' ? 1 : 0] ?? golden.topics[t][0]).join(' / ')
}

function sorted(rs: Result[]): number[] {
  return rs.map((r) => r.bestScore ?? 0).sort((a, b) => a - b)
}

function median(xs: number[]): number {
  const m = xs.length >> 1
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`
}

function f2(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : x.toFixed(2)
}

function of(a: number, b: number): string {
  return `${a} из ${b}`
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ')
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}
