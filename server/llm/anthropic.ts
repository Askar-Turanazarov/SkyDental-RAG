import { sseData } from '../../shared/sse.js'
import { ProviderError, errorFromResponse } from './types.js'
import type { LLMProvider, StreamPart } from './types.js'

/* ============================================================
   Anthropic Messages API. Эмбеддингов у Anthropic нет, поэтому
   этот провайдер годится только для генерации ответа — векторы
   считает EMBED_PROVIDER.
   ============================================================ */

interface AnthropicEvent {
  type: string
  delta?: { type?: string; text?: string }
  message?: { usage?: { input_tokens?: number } }
  usage?: { output_tokens?: number }
  error?: { type?: string; message?: string }
}

export function anthropicProvider(apiKey: string): LLMProvider {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }

  return {
    id: 'anthropic',

    async *stream(model, req): AsyncGenerator<StreamPart> {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        signal: req.signal,
        body: JSON.stringify({
          model,
          system: req.system,
          messages: req.messages.map((m) => ({ role: m.role, content: m.text })),
          max_tokens: req.maxTokens ?? 700,
          temperature: req.temperature ?? 0.2,
          stream: true,
        }),
      })
      if (!res.ok || !res.body) throw await errorFromResponse(res, 'anthropic')

      let inputTokens: number | undefined
      for await (const data of sseData(res.body)) {
        const ev = JSON.parse(data) as AnthropicEvent
        if (ev.type === 'message_start') inputTokens = ev.message?.usage?.input_tokens
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          yield { text: ev.delta.text }
        }
        if (ev.type === 'message_delta' && ev.usage) {
          yield { usage: { inputTokens, outputTokens: ev.usage.output_tokens } }
        }
        if (ev.type === 'error') {
          // overloaded_error приходит прямо в потоке — это повод для fallback.
          const kind = ev.error?.type === 'overloaded_error' ? 'retryable' : 'fatal'
          throw new ProviderError(`anthropic: ${ev.error?.message ?? ev.error?.type}`, kind)
        }
      }
    },

    async listModels(signal?: AbortSignal) {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', { headers, signal })
      if (!res.ok) throw await errorFromResponse(res, 'anthropic')
      const json = (await res.json()) as { data?: { id: string }[] }
      return (json.data ?? []).map((m) => m.id)
    },
  }
}
