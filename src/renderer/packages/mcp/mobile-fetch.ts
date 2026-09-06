import { CapacitorHttp } from '@capacitor/core'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createNativeReadableStream } from '@/native/stream-http'
import { cancelReadableStreamOnAbort } from '@/utils/mobile-request'

function toUrl(input: string | URL): string {
  return input.toString()
}

function toHeaders(_input: string | URL, init?: RequestInit): Record<string, string> {
  const headers = new Headers()
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

function getMethod(_input: string | URL, init?: RequestInit): string {
  return (init?.method || 'GET').toUpperCase()
}

function getBody(_input: string | URL, init?: RequestInit): string | undefined {
  const body = init?.body
  if (typeof body === 'string') return body
  if (body === undefined || body === null) return undefined
  throw new Error(`Unsupported MCP request body type: ${Object.prototype.toString.call(body)}`)
}

function throwIfAborted(signal?: AbortSignal | null) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted', 'AbortError')
  }
}

/**
 * Fetch-compatible adapter for MCP on Capacitor.
 *
 * Buffered requests use CapacitorHttp while long-lived GET/SSE requests use
 * capacitor-stream-http. Both go through Android's native networking stack and
 * therefore avoid WebView CORS restrictions and honor the app network security
 * configuration (including user-installed CAs in the customized APK).
 */
export function createMobileMcpFetch(): FetchLike {
  return async (input, init) => {
    const url = toUrl(input)
    const method = getMethod(input, init)
    const headers = toHeaders(input, init)
    const signal = init?.signal
    throwIfAborted(signal)

    const acceptsEventStream = headers.accept?.toLowerCase().includes('text/event-stream') === true
    if (method === 'GET' && acceptsEventStream) {
      const stream = createNativeReadableStream({ url, method, headers })
      if (signal) {
        const onAbort = () => cancelReadableStreamOnAbort(stream)
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      })
    }

    const response = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: getBody(input, init),
      responseType: 'text',
    })
    throwIfAborted(signal)

    const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
    return new Response(data, {
      status: response.status,
      headers: response.headers,
    })
  }
}
