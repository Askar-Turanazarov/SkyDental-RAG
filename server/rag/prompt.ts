import { NO_ANSWER } from '../../shared/protocol.js'
import type { ChatTurn, Locale, RetrievedChunk } from '../../shared/protocol.js'
import type { GenerateRequest } from '../llm/types.js'

/* ============================================================
   ПРОМПТЫ. Здесь видно, где «R» в RAG встречается с «G»:
   найденные куски пронумерованы и вставлены в сообщение, а модель
   обязана опираться только на них и ставить сноски [n].
   ============================================================ */

const SYSTEM_RAG: Record<Locale, string> = {
  ru: `Ты — ассистент стоматологической клиники SkyDental в Ташкенте.
Отвечай ТОЛЬКО по фрагментам базы знаний клиники, которые даны в сообщении пользователя.

Правила:
1. После каждого утверждения ставь номер фрагмента, на который опираешься: [1], [2][3].
2. Если во фрагментах нет ответа на вопрос, ответь ровно одним словом: ${NO_ANSWER}
3. Не придумывай цены, сроки, имена, адреса и телефоны, которых нет во фрагментах.
4. Фрагменты могут быть на узбекском — передай смысл по-русски.
5. Отвечай по-русски, коротко: 1–4 предложения, обычным текстом, без заголовков и списков.
6. Не ставь диагнозов. Если человек описывает боль или отёк — предложи прийти на осмотр.`,
  uz: `Siz Toshkentdagi SkyDental stomatologiya klinikasining yordamchisisiz.
FAQAT foydalanuvchi xabarida berilgan klinika bilimlar bazasi parchalariga tayanib javob bering.

Qoidalar:
1. Har bir fikrdan keyin tayangan parcha raqamini qo'ying: [1], [2][3].
2. Agar parchalarda savolga javob bo'lmasa, faqat bitta so'z bilan javob bering: ${NO_ANSWER}
3. Parchalarda yo'q narx, muddat, ism, manzil va telefonlarni o'ylab topmang.
4. Parchalar rus tilida bo'lishi mumkin — mazmunini o'zbek tilida yetkazing.
5. O'zbek tilida (lotin yozuvida) qisqa javob bering: 1–4 gap, oddiy matn, sarlavha va ro'yxatlarsiz.
6. Tashxis qo'ymang. Agar odam og'riq yoki shish haqida yozsa — ko'rikka kelishni taklif qiling.`,
}

/** Без базы знаний — для сравнения «RAG вкл/выкл». Модель предоставлена сама себе. */
const SYSTEM_NO_RAG: Record<Locale, string> = {
  ru: 'Ты — ассистент стоматологической клиники SkyDental в Ташкенте. Ответь на вопрос клиента по-русски, коротко: 1–4 предложения.',
  uz: "Siz Toshkentdagi SkyDental stomatologiya klinikasining yordamchisisiz. Mijoz savoliga o'zbek tilida qisqa javob bering: 1–4 gap.",
}

const LABELS: Record<Locale, { context: string; question: string }> = {
  ru: { context: 'Фрагменты базы знаний:', question: 'Вопрос' },
  uz: { context: 'Bilimlar bazasi parchalari:', question: 'Savol' },
}

export function ragRequest(question: string, locale: Locale, chunks: RetrievedChunk[]): GenerateRequest {
  const context = chunks
    .filter((c) => c.n !== null)
    .map((c) => `[${c.n}] (${c.source})\n${c.text}`)
    .join('\n\n')
  const l = LABELS[locale]
  return {
    system: SYSTEM_RAG[locale],
    messages: [{ role: 'user', text: `${l.context}\n\n${context}\n\n${l.question}: ${question}` }],
    temperature: 0.2,
    maxTokens: 700,
  }
}

export function noRagRequest(question: string, locale: Locale): GenerateRequest {
  return {
    system: SYSTEM_NO_RAG[locale],
    messages: [{ role: 'user', text: question }],
    temperature: 0.7,
    maxTokens: 500,
  }
}

/**
 * Переформулировка follow-up вопроса в самостоятельный.
 * «А сколько она стоит?» после разговора об имплантации →
 * «Сколько стоит имплантация?» — иначе поиск не поймёт, о чём речь.
 */
export function condenseRequest(question: string, history: ChatTurn[]): GenerateRequest {
  const dialog = history
    .slice(-6)
    .map((t) => `${t.role === 'user' ? 'Client' : 'Assistant'}: ${t.text}`)
    .join('\n')
  return {
    system:
      'Rewrite the last client question so it is fully understandable without the dialog. ' +
      'Keep the language of the question (Russian or Uzbek). Return only the rewritten question, nothing else. ' +
      'If the question is already self-contained, return it unchanged.',
    messages: [{ role: 'user', text: `${dialog}\n\nLast question: ${question}` }],
    temperature: 0,
    maxTokens: 120,
  }
}
