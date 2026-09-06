// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

const { capacitorRequestMock, platformMock } = vi.hoisted(() => ({
  capacitorRequestMock: vi.fn(),
  platformMock: { type: 'web' },
}))

vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: capacitorRequestMock } }))
vi.mock('@/platform', () => ({ default: platformMock }))
vi.mock('@/stores/settingActions', () => ({ getLanguage: vi.fn(() => 'en') }))

import { extractReadableWebpage, readWebpage, validateReadableWebUrl } from './read-webpage'
import { SearXNGSearch } from './searxng'

function response(params: { status?: number; url?: string; headers?: Record<string, string>; text?: string } = {}) {
  return {
    status: params.status ?? 200,
    url: params.url ?? 'https://news.example.com/article',
    headers: new Headers(params.headers ?? { 'content-type': 'text/html; charset=utf-8' }),
    text: vi.fn().mockResolvedValue(params.text ?? '<html><body>ok</body></html>'),
  }
}

describe('read webpage security and extraction', () => {
  afterEach(() => {
    platformMock.type = 'web'
    capacitorRequestMock.mockReset()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('allows public HTTP(S) pages and rejects unsafe or private destinations', () => {
    expect(validateReadableWebUrl('https://news.example.com/article').hostname).toBe('news.example.com')
    expect(() => validateReadableWebUrl('file:///etc/passwd')).toThrow('HTTP and HTTPS')
    expect(() => validateReadableWebUrl('https://user:secret@example.com')).toThrow('credentials')
    expect(() => validateReadableWebUrl('http://localhost/admin')).toThrow('local or private')
    expect(() => validateReadableWebUrl('http://127.0.0.1/admin')).toThrow('local or private')
    expect(() => validateReadableWebUrl('http://192.168.1.1/admin')).toThrow('local or private')
    expect(() => validateReadableWebUrl('http://[::1]/admin')).toThrow('local or private')
  })

  it('extracts the article title and complete main text while excluding scripts and navigation', () => {
    const html = `<!doctype html><html><head><title>Fallback title</title></head><body>
      <nav>Home Products Advertising</nav>
      <main><article>
        <h1>Research result</h1>
        <p>This is the first paragraph with enough useful information for the reader.</p>
        <p>This is the second paragraph containing the important conclusion and details.</p>
        <script>ignoreDangerousCode()</script>
      </article></main>
    </body></html>`

    const result = extractReadableWebpage(html, 'https://news.example.com/research')

    expect(result.url).toBe('https://news.example.com/research')
    expect(result.title).toBe('Fallback title')
    expect(result.content).toContain('first paragraph')
    expect(result.content).toContain('important conclusion')
    expect(result.content).not.toContain('ignoreDangerousCode')
    expect(result.content).not.toContain('Advertising')
  })

  it('downloads and extracts an HTML article', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        text: `<!doctype html><html><head><title>Example article</title></head><body><article>
          <h1>Example article</h1><p>${'Complete article content. '.repeat(10)}</p>
        </article></body></html>`,
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await readWebpage('https://news.example.com/article')

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: 'GET', redirect: 'manual' })
    )
    expect(result.title).toContain('Example article')
    expect(result.content).toContain('Complete article content')
  })

  it('makes webpage reading available through the SearXNG provider', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          text: `<!doctype html><html><head><title>Provider article</title></head><body><article>
            <p>${'Detailed provider content. '.repeat(10)}</p>
          </article></body></html>`,
        })
      )
    )
    const provider = new SearXNGSearch({ baseUrl: 'https://search.example.com' })

    expect(provider.supportsParseLink).toBe(true)
    await expect(provider.parseLink('https://news.example.com/article')).resolves.toMatchObject({
      title: 'Provider article',
      content: expect.stringContaining('Detailed provider content'),
    })
  })

  it('uses native Capacitor HTTP with timeouts on mobile without forwarding SearXNG credentials', async () => {
    platformMock.type = 'mobile'
    capacitorRequestMock.mockResolvedValue({
      status: 200,
      url: 'https://news.example.com/article',
      headers: { 'content-type': 'text/html' },
      data: `<!doctype html><html><head><title>Mobile article</title></head><body><article>
        <p>${'Native mobile page content. '.repeat(10)}</p>
      </article></body></html>`,
    })
    const provider = new SearXNGSearch({
      baseUrl: 'https://search.example.com',
      auth: { type: 'bearer', token: 'must-not-leak' },
    })

    await expect(provider.parseLink('https://news.example.com/article')).resolves.toMatchObject({
      title: 'Mobile article',
    })
    expect(capacitorRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://news.example.com/article',
        method: 'GET',
        responseType: 'text',
        disableRedirects: true,
        connectTimeout: 15_000,
        readTimeout: 30_000,
        headers: expect.not.objectContaining({ Authorization: expect.anything() }),
      })
    )
  })

  it('rejects redirects to local network destinations before making the second request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        status: 302,
        headers: { location: 'http://127.0.0.1/router' },
        text: '',
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(readWebpage('https://news.example.com/redirect')).rejects.toThrow('local or private')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects non-page response types and oversized responses', async () => {
    const pdfFetch = vi.fn().mockResolvedValue(response({ headers: { 'content-type': 'application/pdf' } }))
    vi.stubGlobal('fetch', pdfFetch)
    await expect(readWebpage('https://news.example.com/file.pdf')).rejects.toThrow('content type')

    const largeFetch = vi
      .fn()
      .mockResolvedValue(
        response({ headers: { 'content-type': 'text/html', 'content-length': String(6 * 1024 * 1024) } })
      )
    vi.stubGlobal('fetch', largeFetch)
    await expect(readWebpage('https://news.example.com/large')).rejects.toThrow('too large')
  })
})
