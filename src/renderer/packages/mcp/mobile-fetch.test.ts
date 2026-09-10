import { beforeEach, describe, expect, it, vi } from 'vitest'

const { capacitorRequest, createStream } = vi.hoisted(() => ({
  capacitorRequest: vi.fn(),
  createStream: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  },
  CapacitorHttp: { request: capacitorRequest },
  registerPlugin: () => ({ start: vi.fn(), stop: vi.fn() }),
}))

vi.mock('@/native/stream-http', () => ({
  createNativeReadableStream: createStream,
}))

import { createMobileMcpFetch } from './mobile-fetch'

describe('createMobileMcpFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses CapacitorHttp for buffered MCP requests and preserves status and headers', async () => {
    capacitorRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
      data: '{"jsonrpc":"2.0","id":1,"result":{}}',
    })

    const fetch = createMobileMcpFetch()
    const response = await fetch('https://mcp.example.test/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
    })

    expect(capacitorRequest).toHaveBeenCalledWith({
      url: 'https://mcp.example.test/mcp',
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      data: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
      responseType: 'text',
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('mcp-session-id')).toBe('session-1')
    expect(await response.text()).toContain('"result"')
  })

  it('uses the native streaming plugin for GET event streams', async () => {
    const encoder = new TextEncoder()
    createStream.mockReturnValue(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event: message\ndata: {"jsonrpc":"2.0"}\n\n'))
          controller.close()
        },
      })
    )

    const fetch = createMobileMcpFetch()
    const response = await fetch('https://mcp.example.test/mcp', {
      method: 'GET',
      headers: { Accept: 'text/event-stream', 'Mcp-Session-Id': 'session-1' },
    })

    expect(capacitorRequest).not.toHaveBeenCalled()
    expect(createStream).toHaveBeenCalledWith(
      {
        url: 'https://mcp.example.test/mcp',
        method: 'GET',
        headers: { accept: 'text/event-stream', 'mcp-session-id': 'session-1' },
      },
      { signal: undefined }
    )
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toContain('data:')
  })

  it('does not start a native request when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetch = createMobileMcpFetch()

    await expect(
      fetch('https://mcp.example.test/mcp', {
        method: 'POST',
        body: '{}',
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(capacitorRequest).not.toHaveBeenCalled()
  })
})
