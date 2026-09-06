// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

const { capacitorRequestMock, platformMock } = vi.hoisted(() => ({
  capacitorRequestMock: vi.fn(),
  platformMock: { type: 'web' },
}))

vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: capacitorRequestMock } }))
vi.mock('@/platform', () => ({ default: platformMock }))

import { normalizeFirecrawlEndpoint, readWebpageWithFirecrawl } from './firecrawl'

describe('Firecrawl webpage reader', () => {
  afterEach(() => {
    platformMock.type = 'web'
    capacitorRequestMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('normalizes server base URLs and preserves explicit scrape endpoints', () => {
    expect(normalizeFirecrawlEndpoint('https://crawl.example.com')).toBe('https://crawl.example.com/v2/scrape')
    expect(normalizeFirecrawlEndpoint('https://crawl.example.com/v1')).toBe('https://crawl.example.com/v1/scrape')
    expect(normalizeFirecrawlEndpoint('https://crawl.example.com/v2/scrape')).toBe(
      'https://crawl.example.com/v2/scrape'
    )
    expect(() => normalizeFirecrawlEndpoint('file:///tmp/firecrawl')).toThrow('HTTP or HTTPS')
    expect(() => normalizeFirecrawlEndpoint('https://user:password@crawl.example.com')).toThrow('credentials')
  })

  it('uses the v2 scrape API on desktop and parses markdown metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          markdown: '# Article\n\nComplete page text.',
          metadata: { title: 'Article title', sourceURL: 'https://news.example.com/article' },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      readWebpageWithFirecrawl('https://news.example.com/article', {
        endpoint: 'https://crawl.example.com',
        bearerToken: 'secret-token',
        timeoutSeconds: 30,
      })
    ).resolves.toEqual({
      url: 'https://news.example.com/article',
      title: 'Article title',
      content: '# Article\n\nComplete page text.',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://crawl.example.com/v2/scrape',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
        body: expect.stringContaining('"onlyMainContent":true'),
      })
    )
  })

  it('uses native Capacitor HTTP on mobile and omits an empty token', async () => {
    platformMock.type = 'mobile'
    capacitorRequestMock.mockResolvedValue({
      status: 200,
      data: { success: true, data: { markdown: 'Mobile result', metadata: { title: 'Mobile page' } } },
    })

    await expect(
      readWebpageWithFirecrawl('https://news.example.com/mobile', {
        endpoint: 'http://192.168.1.10:3002',
        timeoutSeconds: 60,
      })
    ).resolves.toMatchObject({ title: 'Mobile page', content: 'Mobile result' })
    expect(capacitorRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://192.168.1.10:3002/v2/scrape',
        method: 'POST',
        connectTimeout: 15_000,
        readTimeout: 60_000,
        headers: expect.not.objectContaining({ Authorization: expect.anything() }),
      })
    )
  })

  it('rejects unsafe target URLs before contacting Firecrawl', async () => {
    await expect(
      readWebpageWithFirecrawl('http://192.168.1.1/admin', { endpoint: 'https://crawl.example.com' })
    ).rejects.toThrow('local or private')
    expect(capacitorRequestMock).not.toHaveBeenCalled()
  })

  it('surfaces HTTP and empty-content failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    await expect(
      readWebpageWithFirecrawl('https://news.example.com/article', { endpoint: 'https://crawl.example.com' })
    ).rejects.toThrow('HTTP 401')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ success: true, data: { markdown: '' } }),
      })
    )
    await expect(
      readWebpageWithFirecrawl('https://news.example.com/article', { endpoint: 'https://crawl.example.com' })
    ).rejects.toThrow('no readable')
  })
})
