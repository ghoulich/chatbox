import { CapacitorHttp } from '@capacitor/core'
import { Readability } from '@mozilla/readability'
import platform from '@/platform'
import { getSearchAcceptLanguage } from './accept-language'
import type { ParseLinkResult } from './base'

const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5
const CONNECT_TIMEOUT_MS = 15_000
const READ_TIMEOUT_MS = 30_000
const PAGE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'

interface PageResponse {
  status: number
  headers: Record<string, string>
  url: string
  text: string
}

function normalizedHostname(url: URL): string {
  return url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
}

function isBlockedIPv4(hostname: string): boolean {
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false
  const octets = parts.map(Number)
  if (octets.some((octet) => octet < 0 || octet > 255)) return true
  const [a, b] = octets

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isBlockedIPv6(hostname: string): boolean {
  if (!hostname.includes(':')) return false
  const host = hostname.toLowerCase()
  if (host === '::' || host === '::1') return true
  if (host.startsWith('fc') || host.startsWith('fd')) return true
  if (/^fe[89ab]/.test(host)) return true
  if (host.startsWith('ff')) return true
  if (host.startsWith('::ffff:')) {
    return isBlockedIPv4(host.slice('::ffff:'.length))
  }
  return false
}

/**
 * The model may supply this URL, so reject schemes and destinations that could
 * expose files, credentials, or common services on the user's local network.
 */
export function validateReadableWebUrl(rawUrl: string, baseUrl?: string): URL {
  let url: URL
  try {
    url = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl)
  } catch {
    throw new Error('The webpage URL is invalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS webpages can be read')
  }
  if (url.username || url.password) {
    throw new Error('Webpage URLs containing credentials are not allowed')
  }

  const hostname = normalizedHostname(url)
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    isBlockedIPv4(hostname) ||
    isBlockedIPv6(hostname)
  ) {
    throw new Error('Reading local or private network webpages is not allowed')
  }
  return url
}

function getHeader(headers: Record<string, string>, name: string): string {
  const loweredName = name.toLowerCase()
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === loweredName)
  return entry?.[1] ?? ''
}

function assertSupportedContentType(contentType: string, text: string) {
  const normalized = contentType.toLowerCase().split(';')[0].trim()
  const supported =
    !normalized || normalized === 'text/html' || normalized === 'application/xhtml+xml' || normalized === 'text/plain'
  if (!supported) throw new Error(`Unsupported webpage content type: ${normalized}`)

  if (!normalized) {
    const prefix = text.trimStart().slice(0, 80).toLowerCase()
    if (!(prefix.startsWith('<!doctype html') || prefix.startsWith('<html') || prefix.startsWith('<'))) {
      throw new Error('The URL did not return an HTML or plain-text webpage')
    }
  }
}

function assertWithinSizeLimit(text: string, contentLength = '') {
  const declaredLength = Number(contentLength)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('The webpage is too large to read safely')
  }
  if (new TextEncoder().encode(text).byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('The webpage is too large to read safely')
  }
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

async function requestPage(url: URL, signal?: AbortSignal): Promise<PageResponse> {
  const headers = {
    Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
    'Accept-Language': getSearchAcceptLanguage(),
    'User-Agent': PAGE_USER_AGENT,
  }

  if (platform.type === 'mobile') {
    const response = await abortable(
      CapacitorHttp.request({
        url: url.toString(),
        method: 'GET',
        headers,
        responseType: 'text',
        connectTimeout: CONNECT_TIMEOUT_MS,
        readTimeout: READ_TIMEOUT_MS,
        disableRedirects: true,
      }),
      signal
    )
    return {
      status: response.status,
      headers: response.headers,
      url: response.url || url.toString(),
      text: typeof response.data === 'string' ? response.data : String(response.data ?? ''),
    }
  }

  const response = await fetch(url, { method: 'GET', headers, redirect: 'manual', signal })
  const text = await response.text()
  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })
  return {
    status: response.status,
    headers: responseHeaders,
    url: response.url || url.toString(),
    text,
  }
}

async function downloadWebpage(
  rawUrl: string,
  signal?: AbortSignal
): Promise<{ url: string; contentType: string; text: string }> {
  let url = validateReadableWebUrl(rawUrl)
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await requestPage(url, signal)
    const location = getHeader(response.headers, 'location')
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      if (redirectCount === MAX_REDIRECTS) throw new Error('The webpage redirected too many times')
      url = validateReadableWebUrl(location, url.toString())
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`The webpage returned HTTP ${response.status}`)
    }

    validateReadableWebUrl(response.url || url.toString())
    const contentType = getHeader(response.headers, 'content-type')
    assertWithinSizeLimit(response.text, getHeader(response.headers, 'content-length'))
    assertSupportedContentType(contentType, response.text)
    return { url: response.url || url.toString(), contentType, text: response.text }
  }
  throw new Error('The webpage redirected too many times')
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractReadableWebpage(html: string, url: string): ParseLinkResult {
  const validatedUrl = validateReadableWebUrl(url).toString()
  const document = new DOMParser().parseFromString(html, 'text/html')
  const originalTitle = normalizeExtractedText(document.title || '')

  for (const node of Array.from(
    document.querySelectorAll('script, style, noscript, iframe, canvas, svg, form, dialog')
  )) {
    node.remove()
  }
  const readerDocument = document.cloneNode(true) as Document
  const reader = new Readability(readerDocument, { charThreshold: 80, maxElemsToParse: 100_000 })
  const article = reader.parse()
  const content = normalizeExtractedText(article?.textContent || document.body?.textContent || '')
  if (!content) throw new Error('No readable text was found on the webpage')

  let fallbackTitle = validatedUrl
  try {
    fallbackTitle = new URL(validatedUrl).hostname
  } catch {}
  return {
    url: validatedUrl,
    title: normalizeExtractedText(article?.title || originalTitle) || fallbackTitle,
    content,
  }
}

export async function readWebpage(rawUrl: string, signal?: AbortSignal): Promise<ParseLinkResult> {
  const page = await downloadWebpage(rawUrl, signal)
  if (page.contentType.toLowerCase().startsWith('text/plain')) {
    const content = normalizeExtractedText(page.text)
    if (!content) throw new Error('No readable text was found on the webpage')
    return { url: page.url, title: new URL(page.url).hostname, content }
  }
  return extractReadableWebpage(page.text, page.url)
}
