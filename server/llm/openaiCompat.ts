import { sseData } from '../../shared/sse.js'
import { EMBED_DIM } from '../env.js'
import { errorFromResponse, normalize } from './types.js'
import type { EmbedKind, LLMProvider, StreamPart } from './types.js'

/* ============================================================
   OpenAI-совместимый API: /chat/completions, /embeddings, /models.

   Один адаптер закрывает сразу несколько провайдеров — OpenAI,
   OpenRouter, Groq, DeepSeek и локальный Ollama. Они отличаются
   только адресом, ключом и мелкими особенностями (options ниже).
   ============================================================ */

export interface OpenAICompatOptions {
  id: string
  baseURL: string
  apiKey?: string
  /** OpenAI для новых моделей ждёт max_completion_tokens, остальные — max_tokens. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
  /** Понимает ли /embeddings параметр dimensions. */
  embedDimensions?: boolean
  extraHeaders?: Record<string, string>
}

interface ChatChunk {
  choices?: { delta?: { content?: string | null } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
}

export function openAICompatProvider(o: OpenAICompatOptions): LLMProvider {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(o.apiKey ? { Authorization: `Bearer ${o.apiKey}` } : {}),
    ...o.extraHeaders,
  }
  const base = o.baseURL.replace(/\/$/, '')

  return {
    id: o.id,

    async *stream(model, req): AsyncGenerator<StreamPart> {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        signal: req.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: req.system },
            ...req.messages.map((m) => ({ role: m.role, content: m.text })),
          ],
          temperature: req.temperature ?? 0.2,
          [o.maxTokensField ?? 'max_tokens']: req.maxTokens ?? 700,
          stream: true,
          stream_options: { include_usage: true },
        }),
      })
      if (!res.ok || !res.body) throw await errorFromResponse(res, o.id)

      for await (const data of sseData(res.body)) {
        if (data === '[DONE]') break
        const chunk = JSON.parse(data) as ChatChunk
        const text = chunk.choices?.[0]?.delta?.content
        if (text) yield { text }
        if (chunk.usage) {
          yield { usage: { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens } }
        }
      }
    },

    async embed(model: string, texts: string[], _kind: EmbedKind, signal?: AbortSignal) {
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model,
          input: texts,
          ...(o.embedDimensions ? { dimensions: EMBED_DIM } : {}),
        }),
      })
      if (!res.ok) throw await errorFromResponse(res, o.id)
      const json = (await res.json()) as { data: { embedding: number[]; index: number }[] }
      return json.data.sort((a, b) => a.index - b.index).map((d) => normalize(d.embedding))
    },

    async listModels(signal?: AbortSignal) {
      const res = await fetch(`${base}/models`, { headers, signal })
      if (!res.ok) throw await errorFromResponse(res, o.id)
      const json = (await res.json()) as { data?: { id: string }[] }
      return (json.data ?? []).map((m) => m.id)
    },
  }
}
