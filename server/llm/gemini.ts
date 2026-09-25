import { sseData } from '../../shared/sse.js'
import { EMBED_DIM } from '../env.js'
import { ProviderError, errorFromResponse, normalize } from './types.js'
import type { EmbedKind, GenerateRequest, LLMProvider, StreamPart } from './types.js'

/* ============================================================
   Gemini через REST API (generativelanguage.googleapis.com).

   Без SDK намеренно: все адаптеры устроены одинаково — fetch,
   стрим SSE, статус ответа → класс ошибки для fallback. Так на
   уроке видно, что «провайдер» — это просто HTTP-запрос.
   ============================================================ */

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
  promptFeedback?: { blockReason?: string }
}

export function geminiProvider(apiKey: string, thinkingLevel: 'minimal' | 'low' | 'off'): LLMProvider {
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }
  /** Модели, которые отвергли thinkingConfig: больше его им не шлём. */
  const noThinking = new Set<string>()

  function body(req: GenerateRequest, withThinking: boolean) {
    const generationConfig: Record<string, unknown> = {
      temperature: req.temperature ?? 0.2,
      maxOutputTokens: req.maxTokens ?? 700,
    }
    // Gemini 3 думает по умолчанию. Для ответа по готовым кускам
    // рассуждения не нужны: минимальный уровень = быстрее и дешевле.
    if (withThinking) generationConfig.thinkingConfig = { thinkingLevel }
    return JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text }],
      })),
      generationConfig,
    })
  }

  async function open(model: string, req: GenerateRequest): Promise<Response> {
    const url = `${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
    const wantThinking = thinkingLevel !== 'off' && /^gemini-3/.test(model) && !noThinking.has(model)
    let res = await fetch(url, { method: 'POST', headers, body: body(req, wantThinking), signal: req.signal })
    if (res.status === 400 && wantThinking) {
      const text = await res.clone().text()
      if (/thinking/i.test(text)) {
        // Модель не поддерживает уровень reasoning — повторяем без него.
        noThinking.add(model)
        res = await fetch(url, { method: 'POST', headers, body: body(req, false), signal: req.signal })
      }
    }
    return res
  }

  return {
    id: 'gemini',

    async *stream(model, req): AsyncGenerator<StreamPart> {
      const res = await open(model, req)
      if (!res.ok || !res.body) throw await errorFromResponse(res, 'gemini')

      let usage: StreamPart['usage']
      for await (const data of sseData(res.body)) {
        const chunk = JSON.parse(data) as GeminiChunk
        if (chunk.promptFeedback?.blockReason) {
          throw new ProviderError(`gemini blocked: ${chunk.promptFeedback.blockReason}`, 'fatal')
        }
        const parts = chunk.candidates?.[0]?.content?.parts ?? []
        const text = parts
          .filter((p) => !p.thought && p.text)
          .map((p) => p.text)
          .join('')
        if (text) yield { text }
        if (chunk.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount,
            outputTokens:
              (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0),
          }
        }
      }
      if (usage) yield { usage }
    },

    async embed(model: string, texts: string[], kind: EmbedKind, signal?: AbortSignal) {
      const out: number[][] = []
      // batchEmbedContents принимает до 100 текстов за раз.
      for (let i = 0; i < texts.length; i += 100) {
        const batch = texts.slice(i, i + 100)
        const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:batchEmbedContents`, {
          method: 'POST',
          headers,
          signal,
          body: JSON.stringify({
            requests: batch.map((text) => ({
              model: `models/${model}`,
              content: { parts: [{ text }] },
              // Вопрос и документ кодируются по-разному: так модель
              // сближает вопрос с ответом, а не с похожим вопросом.
              taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
              outputDimensionality: EMBED_DIM,
            })),
          }),
        })
        if (!res.ok) throw await errorFromResponse(res, 'gemini')
        const json = (await res.json()) as { embeddings: { values: number[] }[] }
        // При урезанной размерности Google просит нормировать вектор самим.
        out.push(...json.embeddings.map((e) => normalize(e.values)))
      }
      return out
    },

    async listModels(signal?: AbortSignal) {
      const res = await fetch(`${BASE}/models?pageSize=1000`, { headers, signal })
      if (!res.ok) throw await errorFromResponse(res, 'gemini')
      const json = (await res.json()) as { models?: { name: string }[] }
      return (json.models ?? []).map((m) => m.name.replace(/^models\//, ''))
    },
  }
}
