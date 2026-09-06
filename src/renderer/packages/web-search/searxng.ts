import type { ImageSearchResultItem } from '@shared/image-search-tool'
import type { Language, SearchResult } from '@shared/types'
import type { VideoPlaybackFilter, VideoPlaybackMode, VideoSearchResultItem } from '@shared/video-search-tool'
import { normalizeSearchEngines } from '@shared/web-search-tool'
import { getLanguage } from '@/stores/settingActions'
import WebSearch, { type ParseLinkResult } from './base'
import { readWebpage } from './read-webpage'

export type SearXNGAuth =
  | { type: 'none' }
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string }

export interface SearXNGOptions {
  baseUrl: string
  auth?: SearXNGAuth
  maxResults?: number
  safeSearch?: 0 | 1 | 2
  imageProbe?: ImageAccessibilityProbe
}

export type ImageAccessibilityProbe = (url: string, signal?: AbortSignal) => Promise<boolean>

type SearXNGResult = Record<string, unknown>
type SearXNGResponse = { results?: unknown }

const LANGUAGE_MAP: Partial<Record<Language, string>> = {
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
  'pt-PT': 'pt-PT',
  'it-IT': 'it-IT',
  'nb-NO': 'nb-NO',
}

function stringValue(record: SearXNGResult, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function normalizeSearXNGBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('SearXNG base URL is required')
  const url = new URL(trimmed)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('SearXNG base URL must use HTTP or HTTPS')
  }
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

export async function probeDisplayableImage(url: string, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  if (typeof globalThis.Image !== 'function') return false

  return await new Promise<boolean>((resolve, reject) => {
    const image = new globalThis.Image()
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      image.onload = null
      image.onerror = null
      if (!value) image.src = ''
      resolve(value)
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      image.src = ''
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    const timeout = setTimeout(() => finish(false), 8_000)
    signal?.addEventListener('abort', onAbort, { once: true })
    image.referrerPolicy = 'no-referrer'
    image.decoding = 'async'
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0)
    image.onerror = () => finish(false)
    image.src = url
  })
}

function normalizeHttpUrl(raw: string, baseUrl: string): string {
  if (!raw) return ''
  try {
    const url = new URL(raw, `${baseUrl}/`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function encodeBasicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function parseResolution(record: SearXNGResult): string {
  const explicit = stringValue(record, 'resolution')
  if (explicit) return explicit
  const width = record.width
  const height = record.height
  if (typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0) {
    return `${width} × ${height}`
  }
  return ''
}

function scalarValue(record: SearXNGResult, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function youtubeVideoId(url: URL): string {
  if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] ?? ''
  if (url.hostname.endsWith('youtube.com')) {
    if (url.pathname === '/watch') return url.searchParams.get('v') ?? ''
    const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/)
    return match?.[1] ?? ''
  }
  return ''
}

export function deriveVideoPlayback(
  pageUrl: string,
  iframeUrl = ''
): {
  playbackUrl: string
  playbackMode: VideoPlaybackMode
} {
  if (iframeUrl) return { playbackUrl: iframeUrl, playbackMode: 'iframe' }
  try {
    const url = new URL(pageUrl)
    if (/\.(?:mp4|webm|ogv|m3u8)(?:$|[?#])/i.test(url.toString())) {
      return { playbackUrl: url.toString(), playbackMode: 'video' }
    }

    const youtubeId = youtubeVideoId(url)
    if (youtubeId) {
      return {
        playbackUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1`,
        playbackMode: 'iframe',
      }
    }

    if (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com')) {
      const match = url.pathname.match(/\/video\/(BV[A-Za-z0-9]+|av(\d+))/i)
      if (match?.[1]) {
        const id = match[1]
        const parameter = id.toLowerCase().startsWith('av') ? `aid=${match[2]}` : `bvid=${id}`
        return {
          playbackUrl: `https://player.bilibili.com/player.html?${parameter}&page=1&autoplay=1`,
          playbackMode: 'iframe',
        }
      }
    }

    if (url.hostname === 'vimeo.com' || url.hostname.endsWith('.vimeo.com')) {
      const match = url.pathname.match(/\/(?:video\/)?(\d+)/)
      if (match?.[1]) {
        return {
          playbackUrl: `https://player.vimeo.com/video/${match[1]}?autoplay=1`,
          playbackMode: 'iframe',
        }
      }
    }

    if (url.hostname === 'pornhub.com' || url.hostname.endsWith('.pornhub.com')) {
      const viewKey = url.searchParams.get('viewkey')
      if (viewKey && /^[A-Za-z0-9_-]+$/.test(viewKey)) {
        return {
          playbackUrl: `https://www.pornhub.com/embed/${encodeURIComponent(viewKey)}`,
          playbackMode: 'iframe',
        }
      }
    }
  } catch {
    // The caller already validates result URLs; keep malformed values webpage-only.
  }
  return { playbackUrl: '', playbackMode: 'webpage' }
}

function getAppSearchLanguage(): string {
  const language = getLanguage()
  return LANGUAGE_MAP[language] ?? language
}

export class SearXNGSearch extends WebSearch {
  override supportsParseLink = true

  readonly baseUrl: string
  private readonly auth: SearXNGAuth
  private readonly maxResults: number
  private readonly safeSearch: 0 | 1 | 2
  private readonly imageProbe: ImageAccessibilityProbe

  constructor(options: SearXNGOptions) {
    super()
    this.baseUrl = normalizeSearXNGBaseUrl(options.baseUrl)
    this.auth = options.auth ?? { type: 'none' }
    this.maxResults = Math.min(Math.max(Math.trunc(options.maxResults ?? 10), 1), 20)
    this.safeSearch = options.safeSearch ?? 1
    this.imageProbe = options.imageProbe ?? probeDisplayableImage
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.auth.type === 'basic') {
      headers.Authorization = `Basic ${encodeBasicAuth(this.auth.username, this.auth.password)}`
    } else if (this.auth.type === 'bearer' && this.auth.token.trim()) {
      headers.Authorization = `Bearer ${this.auth.token.trim()}`
    }
    return headers
  }

  private async request(
    query: string,
    category: 'general' | 'images' | 'videos',
    signal?: AbortSignal,
    engines: string[] = []
  ): Promise<SearXNGResult[]> {
    const normalizedEngines = normalizeSearchEngines(engines)
    const response = await this.fetch(`${this.baseUrl}/search`, {
      method: 'GET',
      headers: this.getHeaders(),
      query: {
        q: query,
        categories: category,
        format: 'json',
        language: getAppSearchLanguage(),
        safesearch: String(this.safeSearch),
        pageno: '1',
        ...(normalizedEngines.length > 0 ? { engines: normalizedEngines.join(',') } : {}),
      },
      responseType: 'json',
      signal,
    })
    const payload = (typeof response === 'string' ? JSON.parse(response) : response) as SearXNGResponse
    if (!Array.isArray(payload?.results)) return []
    return payload.results.filter(
      (item): item is SearXNGResult => typeof item === 'object' && item !== null && !Array.isArray(item)
    )
  }

  async search(query: string, signal?: AbortSignal, engines: string[] = []): Promise<SearchResult> {
    const results = await this.request(query, 'general', signal, engines)
    const items = results
      .map((result) => {
        const link = normalizeHttpUrl(stringValue(result, 'url'), this.baseUrl)
        if (!link) return null
        return {
          title: stringValue(result, 'title') || link,
          snippet: stringValue(result, 'content', 'snippet'),
          link,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, this.maxResults)
    return { items }
  }

  async searchImages(query: string, signal?: AbortSignal, engines: string[] = []): Promise<ImageSearchResultItem[]> {
    const results = await this.request(query, 'images', signal, engines)
    const seen = new Set<string>()
    const items: ImageSearchResultItem[] = []
    const candidates: Array<{ result: SearXNGResult; originalImageUrl: string; thumbnailUrl: string }> = []

    for (const result of results.slice(0, Math.max(20, this.maxResults * 4))) {
      const originalImageUrl = normalizeHttpUrl(stringValue(result, 'img_src', 'image'), this.baseUrl)
      const thumbnailUrl = normalizeHttpUrl(stringValue(result, 'thumbnail_src', 'thumbnail'), this.baseUrl)
      const candidateUrl = originalImageUrl || thumbnailUrl
      if (!candidateUrl || seen.has(candidateUrl)) continue
      seen.add(candidateUrl)
      candidates.push({ result, originalImageUrl, thumbnailUrl })
    }

    const probe = async (url: string) => {
      if (!url) return false
      try {
        return await this.imageProbe(url, signal)
      } catch (error) {
        if (signal?.aborted) throw error
        return false
      }
    }

    for (let offset = 0; offset < candidates.length && items.length < this.maxResults; offset += 4) {
      const batch = candidates.slice(offset, offset + 4)
      const checked = await Promise.all(
        batch.map(async ({ result, originalImageUrl, thumbnailUrl }) => {
          const [originalAvailable, thumbnailAvailable] = await Promise.all([
            probe(originalImageUrl),
            thumbnailUrl && thumbnailUrl !== originalImageUrl ? probe(thumbnailUrl) : Promise.resolve(false),
          ])
          const imageUrl = originalAvailable ? originalImageUrl : thumbnailAvailable ? thumbnailUrl : ''
          if (!imageUrl) return null
          const displayThumbnail = thumbnailAvailable ? thumbnailUrl : imageUrl
          return { result, imageUrl, displayThumbnail }
        })
      )

      for (const checkedItem of checked) {
        if (!checkedItem || items.length >= this.maxResults) continue
        const { result, imageUrl, displayThumbnail } = checkedItem

        const sourceUrl = normalizeHttpUrl(stringValue(result, 'url'), this.baseUrl) || imageUrl
        items.push({
          title: stringValue(result, 'title') || stringValue(result, 'content') || query,
          imageUrl,
          thumbnailUrl: displayThumbnail,
          sourceUrl,
          source: stringValue(result, 'source', 'engine'),
          resolution: parseResolution(result),
        })
      }
    }

    return items
  }

  async searchVideos(
    query: string,
    playback: VideoPlaybackFilter = 'any',
    signal?: AbortSignal,
    engines: string[] = []
  ): Promise<VideoSearchResultItem[]> {
    const results = await this.request(query, 'videos', signal, engines)
    const seen = new Set<string>()
    const candidates: VideoSearchResultItem[] = []

    for (const result of results.slice(0, Math.max(20, this.maxResults * 4))) {
      const url = normalizeHttpUrl(stringValue(result, 'url'), this.baseUrl)
      if (!url || seen.has(url)) continue
      seen.add(url)

      const iframeUrl = normalizeHttpUrl(stringValue(result, 'iframe_src'), this.baseUrl)
      const playbackInfo = deriveVideoPlayback(url, iframeUrl)
      if (playback === 'in_app' && playbackInfo.playbackMode === 'webpage') continue

      candidates.push({
        title: stringValue(result, 'title') || stringValue(result, 'content') || url,
        url,
        thumbnailUrl: normalizeHttpUrl(stringValue(result, 'thumbnail', 'thumbnail_src', 'img_src'), this.baseUrl),
        playbackUrl: playbackInfo.playbackUrl,
        playbackMode: playbackInfo.playbackMode,
        source: stringValue(result, 'source', 'engine'),
        author: stringValue(result, 'author'),
        duration: scalarValue(result, 'length', 'duration'),
        publishedDate: scalarValue(result, 'publishedDate', 'pubdate'),
      })
    }

    const items: VideoSearchResultItem[] = []
    for (let offset = 0; offset < candidates.length && items.length < this.maxResults; offset += 4) {
      const batch = candidates.slice(offset, offset + 4)
      const checked = await Promise.all(
        batch.map(async (candidate) => {
          if (!candidate.thumbnailUrl) return candidate
          try {
            const available = await this.imageProbe(candidate.thumbnailUrl, signal)
            return available ? candidate : { ...candidate, thumbnailUrl: '' }
          } catch (error) {
            if (signal?.aborted) throw error
            return { ...candidate, thumbnailUrl: '' }
          }
        })
      )
      for (const item of checked) {
        if (items.length >= this.maxResults) break
        items.push(item)
      }
    }
    return items
  }

  async parseLink(url: string, signal?: AbortSignal): Promise<ParseLinkResult> {
    return await readWebpage(url, signal)
  }
}
