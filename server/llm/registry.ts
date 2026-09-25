import { env } from '../env.js'
import { anthropicProvider } from './anthropic.js'
import { geminiProvider } from './gemini.js'
import { localProvider } from './local.js'
import { openAICompatProvider } from './openaiCompat.js'
import type { LLMProvider } from './types.js'

/* ============================================================
   Реестр провайдеров: подключаются только те, для которых в
   окружении есть ключ (или адрес — для Ollama). Офлайн-провайдер
   `local` есть всегда.

   Добавить нового OpenAI-совместимого провайдера — одна запись
   ниже: адрес API и переменная с ключом.
   ============================================================ */

function build(): Map<string, LLMProvider> {
  const list: LLMProvider[] = [localProvider()]

  if (env.GEMINI_API_KEY) list.push(geminiProvider(env.GEMINI_API_KEY, env.GEMINI_THINKING_LEVEL))
  if (env.ANTHROPIC_API_KEY) list.push(anthropicProvider(env.ANTHROPIC_API_KEY))
  if (env.OPENAI_API_KEY) {
    list.push(
      openAICompatProvider({
        id: 'openai',
        baseURL: 'https://api.openai.com/v1',
        apiKey: env.OPENAI_API_KEY,
        maxTokensField: 'max_completion_tokens',
        embedDimensions: true,
      }),
    )
  }
  if (env.OPENROUTER_API_KEY) {
    list.push(
      openAICompatProvider({
        id: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: env.OPENROUTER_API_KEY,
        extraHeaders: { 'X-Title': 'SkyDental RAG' },
      }),
    )
  }
  if (env.GROQ_API_KEY) {
    list.push(openAICompatProvider({ id: 'groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: env.GROQ_API_KEY }))
  }
  if (env.DEEPSEEK_API_KEY) {
    list.push(
      openAICompatProvider({ id: 'deepseek', baseURL: 'https://api.deepseek.com/v1', apiKey: env.DEEPSEEK_API_KEY }),
    )
  }
  if (env.OLLAMA_BASE_URL) {
    list.push(openAICompatProvider({ id: 'ollama', baseURL: env.OLLAMA_BASE_URL }))
  }

  return new Map(list.map((p) => [p.id, p]))
}

export const providers = build()

export interface ChainEntry {
  provider: string
  model: string
}

/** 'gemini:gemini-3.5-flash-lite,openrouter:x/y' → [{provider, model}, …] */
export function parseChain(spec: string): ChainEntry[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(':')
      if (i < 1) throw new Error(`LLM_CHAIN: ожидается provider:model, получено «${s}»`)
      return { provider: s.slice(0, i), model: s.slice(i + 1) }
    })
}

export const chain: ChainEntry[] = parseChain(env.LLM_CHAIN)

export function embedProvider(): LLMProvider {
  const p = providers.get(env.EMBED_PROVIDER)
  if (!p?.embed) {
    throw new Error(
      `EMBED_PROVIDER=${env.EMBED_PROVIDER}: провайдер не подключён (нет ключа) или не умеет считать эмбеддинги`,
    )
  }
  return p
}

/** Метка модели эмбеддингов, которая пишется в chunks.embed_model. */
export const embedModelLabel = `${env.EMBED_PROVIDER}:${env.EMBED_MODEL}`
