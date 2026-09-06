import { CapacitorHttp } from '@capacitor/core'
import platform from '@/platform'
import type { ParseLinkResult } from './base'
import { validateReadableWebUrl } from './read-webpage'

const DEFAULT_TIMEOUT_SECONDS = 60

export interface FirecrawlReaderOptions {
  endpoint: string
  bearerToken?: string
  timeoutSeconds?: number
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export function normalizeFirecrawlEndpoint(rawEndpoint: string): string {
  const value = rawEndpoint.trim()
  if (!value) throw new Error('Firecrawl endpoint is required')

  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new Error('The Firecrawl endpoint is invalid')
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('The Firecrawl endpoint must use HTTP or HTTPS')
  }
  if (endpoint.username || endpoint.password) {
    throw new Error('Firecrawl endpoints containing credentials are not allowed')
  }

  endpoint.hash = ''
  endpoint.search = ''
  const basePath = endpoint.pathname.replace(/\/+$/, '')
  if (/\/(?:v1|v2)\/scrape$/i.test(basePath)) endpoint.pathname = basePath
  else if (/\/(?:v1|v2)$/i.test(basePath)) endpoint.pathname = `${basePath}/scrape`
  else endpoint.pathname = `${basePath}/v2/scrape`
  return endpoint.toString()
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function nonEmptyString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim()
}

function parseFirecrawlResponse(responseData: unknown, requestedUrl: string): ParseLinkResult {
  let payload: unknown = responseData
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      throw new Error('Firecrawl returned an invalid JSON response')
    }
  }

  const response = asRecord(payload)
  if (!response) throw new Error('Firecrawl returned an invalid response')
  if (response.success === false) {
    const detail = nonEmptyString(response.error, response.message)
    throw new Error(detail ? `Firecrawl failed: ${detail}` : 'Firecrawl failed to read the webpage')
  }

  const data = asRecord(response.data) ?? response
  const metadata = asRecord(data.metadata)
  const content = nonEmptyString(data.markdown, data.content, data.text)
  if (!content) throw new Error('Firecrawl returned no readable webpage content')

  const candidateUrl = nonEmptyString(metadata?.sourceURL, metadata?.url, data.url, requestedUrl) ?? requestedUrl
  let finalUrl = requestedUrl
  try {
    finalUrl = validateReadableWebUrl(candidateUrl).toString()
  } catch {
    // A malformed metadata URL must not prevent use of otherwise valid content.
  }
  const title = nonEmptyString(data.title, metadata?.title, metadata?.ogTitle) ?? new URL(finalUrl).hostname

  return { url: finalUrl, title, content }
}

export async function readWebpageWithFirecrawl(
  rawUrl: string,
  options: FirecrawlReaderOptions,
  signal?: AbortSignal
): Promise<ParseLinkResult> {
  const targetUrl = validateReadableWebUrl(rawUrl).toString()
  const endpoint = normalizeFirecrawlEndpoint(options.endpoint)
  const timeoutSeconds = Math.min(Math.max(options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS, 10), 120)
  const timeoutMs = timeoutSeconds * 1000
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  const bearerToken = options.bearerToken?.trim()
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`
  const body = {
    url: targetUrl,
    formats: ['markdown'],
    onlyMainContent: true,
    timeout: timeoutMs,
    removeBase64Images: true,
  }

  if (platform.type === 'mobile') {
    const response = await abortable(
      CapacitorHttp.request({
        url: endpoint,
        method: 'POST',
        headers,
        data: body,
        responseType: 'json',
        connectTimeout: Math.min(timeoutMs, 15_000),
        readTimeout: timeoutMs,
      }),
      signal
    )
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Firecrawl returned HTTP ${response.status}`)
    }
    return parseFirecrawlResponse(response.data, targetUrl)
  }

  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('Firecrawl request timed out')), timeoutMs)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Firecrawl returned HTTP ${response.status}`)
    return parseFirecrawlResponse(await response.json(), targetUrl)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
