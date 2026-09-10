import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createNativeReadableStream } from '@/native/stream-http'

const {
  backgroundStartMock,
  backgroundStopMock,
  capacitorRequestMock,
  nativeStreamMock,
  streamLifecycle,
  toastAddMock,
} = vi.hoisted(() => ({
  backgroundStartMock: vi.fn(),
  backgroundStopMock: vi.fn(),
  capacitorRequestMock: vi.fn(),
  nativeStreamMock: vi.fn(),
  toastAddMock: vi.fn(),
  streamLifecycle: { current: undefined as { onStart?: () => void | Promise<void>; onClose?: () => void } | undefined },
}))

vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: capacitorRequestMock } }))
vi.mock('i18next', () => ({ t: (key: string) => key }))
vi.mock('@/native/background-generation', () => ({
  startBackgroundGeneration: backgroundStartMock,
  stopBackgroundGeneration: backgroundStopMock,
}))
vi.mock('@/native/stream-http', () => ({
  createNativeReadableStream: nativeStreamMock.mockImplementation(
    (_options: unknown, lifecycle: { onStart?: () => void | Promise<void>; onClose?: () => void }) => {
      streamLifecycle.current = lifecycle
      return new ReadableStream<Uint8Array>()
    }
  ),
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ backgroundGenerationEnabled: true }) },
}))
vi.mock('@/stores/toastActions', () => ({ add: toastAddMock }))

import { handleMobileRequest, isStreamingRequestBody } from './mobile-request'

describe('mobile streaming request detection', () => {
  test('recognizes only JSON bodies with stream explicitly enabled', () => {
    expect(isStreamingRequestBody(JSON.stringify({ stream: true, messages: [] }))).toBe(true)
    expect(isStreamingRequestBody(JSON.stringify({ stream: false }))).toBe(false)
    expect(isStreamingRequestBody('not json')).toBe(false)
    expect(isStreamingRequestBody(undefined)).toBe(false)
  })
})

describe('optional background generation service', () => {
  test('continues starting the native stream when Android rejects the foreground service', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    backgroundStartMock.mockRejectedValueOnce(new Error('foreground service unavailable'))

    await handleMobileRequest(
      'https://model.example/v1/chat/completions',
      'POST',
      new Headers(),
      JSON.stringify({ stream: true, messages: [] })
    )

    await expect(streamLifecycle.current?.onStart?.()).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith('Background generation unavailable; continuing without it', expect.any(Error))
    expect(toastAddMock).toHaveBeenCalledWith(expect.stringContaining('Background protection could not start'), 10000, {
      label: 'Settings',
      settingsPath: '/settings/chat',
    })
    warnSpy.mockRestore()
  })
})

describe('mobile request native streaming', () => {
  beforeEach(() => {
    vi.mocked(createNativeReadableStream).mockReset()
    vi.mocked(createNativeReadableStream).mockImplementation((_options, lifecycle) => {
      streamLifecycle.current = lifecycle
      return new ReadableStream<Uint8Array>()
    })
  })

  test('passes the request signal directly to the native stream', async () => {
    const abortController = new AbortController()

    await handleMobileRequest(
      'https://example.com/stream',
      'POST',
      new Headers({ Authorization: 'Bearer test' }),
      JSON.stringify({ stream: true }),
      abortController.signal
    )

    expect(createNativeReadableStream).toHaveBeenCalledWith(
      {
        url: 'https://example.com/stream',
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          authorization: 'Bearer test',
        },
        body: JSON.stringify({ stream: true }),
      },
      expect.objectContaining({ signal: abortController.signal })
    )
  })

  test('passes an already-aborted signal to native stream setup', async () => {
    const abortController = new AbortController()
    abortController.abort(123_456)

    await handleMobileRequest(
      'https://example.com/stream',
      'POST',
      new Headers(),
      JSON.stringify({ stream: true }),
      abortController.signal
    )

    expect(createNativeReadableStream).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ signal: abortController.signal })
    )
  })

  test('passes an explicit undefined signal to native stream setup', async () => {
    await handleMobileRequest('https://example.com/stream', 'POST', new Headers(), JSON.stringify({ stream: true }))

    expect(createNativeReadableStream).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ signal: undefined })
    )
  })
})

describe('mobile buffered request fallback', () => {
  test('retries through native HTTP when CapacitorHttp rejects a user-CA endpoint', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    capacitorRequestMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    nativeStreamMock.mockReturnValueOnce(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":[{"embedding":[1,2,3]}]}'))
          controller.close()
        },
      })
    )

    const response = await handleMobileRequest(
      'https://private-model.example/v1/embeddings',
      'POST',
      new Headers({ 'Content-Type': 'application/json' }),
      JSON.stringify({ input: ['hello'] })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: [{ embedding: [1, 2, 3] }] })
    expect(nativeStreamMock).toHaveBeenCalledWith(
      {
        url: 'https://private-model.example/v1/embeddings',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"input":["hello"]}',
      },
      { signal: undefined }
    )
    expect(warnSpy).toHaveBeenCalledWith(
      'Buffered CapacitorHttp request failed; retrying through native HTTP',
      expect.any(TypeError)
    )
    warnSpy.mockRestore()
  })

  test('retries through native HTTP when CapacitorHttp resolves with status zero', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    capacitorRequestMock.mockResolvedValueOnce({ status: 0, data: 'Failed to fetch', headers: {} })
    nativeStreamMock.mockReturnValueOnce(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":[]}'))
          controller.close()
        },
      })
    )

    const response = await handleMobileRequest(
      'https://private-model.example/v1/embeddings',
      'POST',
      new Headers({ 'Content-Type': 'application/json' }),
      '{}'
    )

    await expect(response.json()).resolves.toEqual({ data: [] })
    expect(warnSpy).toHaveBeenCalledWith(
      'Buffered CapacitorHttp request returned status 0; retrying through native HTTP'
    )
    warnSpy.mockRestore()
  })
})
