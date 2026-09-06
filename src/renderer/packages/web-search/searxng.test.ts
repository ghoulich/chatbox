import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/settingActions', () => ({ getLanguage: vi.fn(() => 'zh-Hans') }))
vi.mock('@/platform', () => ({ default: { type: 'web' } }))

import { deriveVideoPlayback, normalizeSearXNGBaseUrl, probeDisplayableImage, SearXNGSearch } from './searxng'

describe('SearXNGSearch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes and validates the server address', () => {
    expect(normalizeSearXNGBaseUrl(' https://search.example.com/root/ ')).toBe('https://search.example.com/root')
    expect(() => normalizeSearXNGBaseUrl('')).toThrow('required')
    expect(() => normalizeSearXNGBaseUrl('file:///tmp/searxng')).toThrow('HTTP or HTTPS')
  })

  it('accepts only images that the renderer can decode with non-zero dimensions', async () => {
    class LoadableImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = 640
      naturalHeight = 480
      referrerPolicy = ''
      decoding = ''
      private value = ''
      set src(value: string) {
        this.value = value
        if (value) queueMicrotask(() => this.onload?.())
      }
      get src() {
        return this.value
      }
    }
    vi.stubGlobal('Image', LoadableImage)
    try {
      await expect(probeDisplayableImage('https://images.example.com/working.jpg')).resolves.toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('requests and maps ordinary JSON search results', async () => {
    const provider = new SearXNGSearch({ baseUrl: 'https://search.example.com/', maxResults: 2, safeSearch: 2 })
    const fetchMock = vi.spyOn(provider, 'fetch').mockResolvedValue({
      results: [
        { title: 'One', url: 'https://one.example', content: 'First' },
        { title: 'Bad', url: 'javascript:alert(1)', content: 'Unsafe' },
        { title: 'Two', url: '/result/two', content: 'Second' },
      ],
    })

    await expect(provider.search('测试')).resolves.toEqual({
      items: [
        { title: 'One', link: 'https://one.example/', snippet: 'First' },
        { title: 'Two', link: 'https://search.example.com/result/two', snippet: 'Second' },
      ],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://search.example.com/search',
      expect.objectContaining({
        query: expect.objectContaining({
          q: '测试',
          categories: 'general',
          format: 'json',
          language: 'zh-CN',
          safesearch: '2',
        }),
      })
    )
  })

  it('forwards an explicit engine whitelist and omits it by default', async () => {
    const provider = new SearXNGSearch({ baseUrl: 'https://search.example.com' })
    const fetchMock = vi.spyOn(provider, 'fetch').mockResolvedValue({ results: [] })

    await provider.search('privacy', undefined, ['bing', ' duckduckgo ', 'bing'])
    expect(fetchMock.mock.calls[0][1].query).toEqual(expect.objectContaining({ engines: 'bing,duckduckgo' }))

    await provider.search('ordinary')
    expect(fetchMock.mock.calls[1][1].query).not.toHaveProperty('engines')
  })

  it('maps, deduplicates, limits, and safely normalizes image results', async () => {
    const provider = new SearXNGSearch({
      baseUrl: 'https://search.example.com/sub/',
      maxResults: 2,
      imageProbe: async () => true,
    })
    vi.spyOn(provider, 'fetch').mockResolvedValue({
      results: [
        {
          title: 'Aurora',
          img_src: 'https://cdn.example.com/aurora.jpg',
          thumbnail_src: '/thumb/aurora.jpg',
          url: 'https://source.example.com/aurora',
          source: 'wikicommons',
          resolution: '1920 x 1080',
        },
        { title: 'Duplicate', img_src: 'https://cdn.example.com/aurora.jpg' },
        { title: 'Thumbnail only', thumbnail: 'https://cdn.example.com/thumb.jpg', width: 640, height: 480 },
        { title: 'Unsafe', img_src: 'data:image/png;base64,abc' },
      ],
    })

    await expect(provider.searchImages('aurora')).resolves.toEqual([
      {
        title: 'Aurora',
        imageUrl: 'https://cdn.example.com/aurora.jpg',
        thumbnailUrl: 'https://search.example.com/thumb/aurora.jpg',
        sourceUrl: 'https://source.example.com/aurora',
        source: 'wikicommons',
        resolution: '1920 x 1080',
      },
      {
        title: 'Thumbnail only',
        imageUrl: 'https://cdn.example.com/thumb.jpg',
        thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
        sourceUrl: 'https://cdn.example.com/thumb.jpg',
        source: '',
        resolution: '640 × 480',
      },
    ])
  })

  it('drops inaccessible images and continues to later displayable results', async () => {
    const probe = vi.fn(async (url: string) => !url.includes('broken'))
    const provider = new SearXNGSearch({
      baseUrl: 'https://search.example.com',
      maxResults: 2,
      imageProbe: probe,
    })
    vi.spyOn(provider, 'fetch').mockResolvedValue({
      results: [
        {
          title: 'Broken',
          img_src: 'https://images.example.com/broken-full.jpg',
          thumbnail_src: 'https://images.example.com/broken-thumb.jpg',
        },
        {
          title: 'Thumbnail fallback',
          img_src: 'https://images.example.com/broken-original.jpg',
          thumbnail_src: 'https://images.example.com/working-thumb.jpg',
        },
        { title: 'Working next result', img_src: 'https://images.example.com/working-next.jpg' },
      ],
    })

    await expect(provider.searchImages('working')).resolves.toEqual([
      expect.objectContaining({
        title: 'Thumbnail fallback',
        imageUrl: 'https://images.example.com/working-thumb.jpg',
        thumbnailUrl: 'https://images.example.com/working-thumb.jpg',
      }),
      expect.objectContaining({
        title: 'Working next result',
        imageUrl: 'https://images.example.com/working-next.jpg',
      }),
    ])
    expect(probe).toHaveBeenCalledWith('https://images.example.com/broken-full.jpg', undefined)
  })

  it('derives in-app players for mainstream video URLs and keeps unknown sites webpage-only', () => {
    expect(deriveVideoPlayback('https://www.bilibili.com/video/BV1xx411c7mD')).toEqual({
      playbackUrl: 'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1&autoplay=1',
      playbackMode: 'iframe',
    })
    expect(deriveVideoPlayback('https://www.youtube.com/watch?v=abcDEF_1234').playbackUrl).toContain(
      'youtube-nocookie.com/embed/abcDEF_1234'
    )
    expect(deriveVideoPlayback('https://www.pornhub.com/view_video.php?viewkey=phExample')).toEqual({
      playbackUrl: 'https://www.pornhub.com/embed/phExample',
      playbackMode: 'iframe',
    })
    expect(deriveVideoPlayback('https://videos.example.com/watch/123')).toEqual({
      playbackUrl: '',
      playbackMode: 'webpage',
    })
  })

  it('maps video results, validates thumbnails, and supports direct-play-only filtering', async () => {
    const provider = new SearXNGSearch({
      baseUrl: 'https://search.example.com',
      maxResults: 10,
      imageProbe: async (url) => !url.includes('broken'),
    })
    const fetchMock = vi.spyOn(provider, 'fetch').mockResolvedValue({
      results: [
        {
          title: 'Bilibili tutorial',
          url: 'https://www.bilibili.com/video/BV1xx411c7mD',
          thumbnail: 'https://images.example.com/bili.jpg',
          engine: 'bilibili',
          author: 'Operator',
          length: 600,
        },
        {
          title: 'Provided iframe',
          url: 'https://videos.example.com/watch/1',
          iframe_src: 'https://player.example.com/embed/1',
          thumbnail: 'https://images.example.com/broken.jpg',
        },
        {
          title: 'Webpage only',
          url: 'https://videos.example.com/watch/2',
          thumbnail: 'https://images.example.com/web.jpg',
        },
      ],
    })

    const all = await provider.searchVideos('tutorial', 'any')
    expect(all).toHaveLength(3)
    expect(all[0]).toMatchObject({
      playbackMode: 'iframe',
      source: 'bilibili',
      duration: '600',
      thumbnailUrl: 'https://images.example.com/bili.jpg',
    })
    expect(all[1]).toMatchObject({ playbackUrl: 'https://player.example.com/embed/1', thumbnailUrl: '' })
    expect(all[2]).toMatchObject({ playbackMode: 'webpage', playbackUrl: '' })

    const directOnly = await provider.searchVideos('tutorial', 'in_app')
    expect(directOnly).toHaveLength(2)
    expect(directOnly.every((item) => item.playbackMode !== 'webpage')).toBe(true)
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://search.example.com/search',
      expect.objectContaining({ query: expect.objectContaining({ categories: 'videos', format: 'json' }) })
    )
  })

  it('adds Basic and Bearer authorization without putting credentials in the URL', async () => {
    const basic = new SearXNGSearch({
      baseUrl: 'https://search.example.com',
      auth: { type: 'basic', username: 'user', password: 'päss' },
    })
    const basicFetch = vi.spyOn(basic, 'fetch').mockResolvedValue({ results: [] })
    await basic.search('test')
    expect(basicFetch.mock.calls[0][0]).toBe('https://search.example.com/search')
    expect(basicFetch.mock.calls[0][1].headers).toEqual(
      expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) })
    )

    const bearer = new SearXNGSearch({
      baseUrl: 'https://search.example.com',
      auth: { type: 'bearer', token: ' secret-token ' },
    })
    const bearerFetch = vi.spyOn(bearer, 'fetch').mockResolvedValue({ results: [] })
    await bearer.searchImages('test')
    expect(bearerFetch.mock.calls[0][1].headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer secret-token' })
    )
  })

  it('performs an end-to-end JSON image request against an HTTP SearXNG-compatible endpoint', async () => {
    const requests: Array<{ url: string; authorization?: string }> = []
    const server = createServer((request, response) => {
      requests.push({
        url: request.url ?? '',
        authorization: request.headers.authorization,
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          results: [
            {
              title: 'Local result',
              img_src: 'https://images.example.com/local.jpg',
              thumbnail_src: 'https://images.example.com/local-thumb.jpg',
              url: 'https://source.example.com/local',
            },
          ],
        })
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    try {
      const { port } = server.address() as AddressInfo
      const provider = new SearXNGSearch({
        baseUrl: `http://127.0.0.1:${port}`,
        auth: { type: 'bearer', token: 'local-token' },
        imageProbe: async () => true,
      })
      const results = await provider.searchImages('local aurora')

      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({ title: 'Local result', imageUrl: 'https://images.example.com/local.jpg' })
      expect(requests).toHaveLength(1)
      const requestUrl = new URL(requests[0].url, `http://127.0.0.1:${port}`)
      expect(requestUrl.pathname).toBe('/search')
      expect(requestUrl.searchParams.get('q')).toBe('local aurora')
      expect(requestUrl.searchParams.get('categories')).toBe('images')
      expect(requestUrl.searchParams.get('format')).toBe('json')
      expect(requests[0].authorization).toBe('Bearer local-token')
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      )
    }
  })
})
