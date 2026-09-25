/**
 * Минимальный разбор Server-Sent Events из fetch-ответа.
 *
 * EventSource не подходит: он умеет только GET, а вопрос в чат
 * уходит POST-запросом с телом. Поэтому поток читаем сами: события
 * разделены пустой строкой, полезная нагрузка — в строках `data:`.
 * Работает и в браузере, и в Node (серверные адаптеры LLM читают
 * так же стримы Gemini, OpenAI и Anthropic).
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary: RegExpExecArray | null
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const raw = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        const data = extractData(raw)
        if (data !== null) yield data
      }
    }
    const tail = extractData(buffer)
    if (tail !== null) yield tail
  } finally {
    reader.releaseLock()
  }
}

function extractData(raw: string): string | null {
  const lines = raw
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).replace(/^ /, ''))
  return lines.length ? lines.join('\n') : null
}
