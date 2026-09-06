import { describe, expect, test, vi } from 'vitest'

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
    },
  ),
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ backgroundGenerationEnabled: true }) },
}))
vi.mock('@/stores/toastActions', () => ({ add: toastAddMock }))

import { cancelReadableStreamOnAbort, handleMobileRequest, isStreamingRequestBody } from './mobile-request'

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
      JSON.stringify({ stream: true, messages: [] }),
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

describe('mobile request stream cancellation', () => {
  test('swallows locked stream cancel rejections', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const stream = new ReadableStream<Uint8Array>()
    const reader = stream.getReader()

    cancelReadableStreamOnAbort(stream)
    await Promise.resolve()
    await Promise.resolve()

    expect(warnSpy).not.toHaveBeenCalled()
    reader.releaseLock()
    warnSpy.mockRestore()
  })

  test('logs unexpected cancel failures', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const stream = {
      cancel: vi.fn().mockRejectedValue(new Error('boom')),
    } as Pick<ReadableStream<Uint8Array>, 'cancel'> as ReadableStream<Uint8Array>

    cancelReadableStreamOnAbort(stream)
    await Promise.resolve()
    await Promise.resolve()

    expect(warnSpy).toHaveBeenCalledWith('Failed to cancel native stream', expect.any(Error))
    warnSpy.mockRestore()
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
      }),
    )

    const response = await handleMobileRequest(
      'https://private-model.example/v1/embeddings',
      'POST',
      new Headers({ 'Content-Type': 'application/json' }),
      JSON.stringify({ input: ['hello'] }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: [{ embedding: [1, 2, 3] }] })
    expect(nativeStreamMock).toHaveBeenCalledWith({
      url: 'https://private-model.example/v1/embeddings',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"input":["hello"]}',
    })
    expect(warnSpy).toHaveBeenCalledWith(
      'Buffered CapacitorHttp request failed; retrying through native HTTP',
      expect.any(TypeError),
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
      }),
    )

    const response = await handleMobileRequest(
      'https://private-model.example/v1/embeddings',
      'POST',
      new Headers({ 'Content-Type': 'application/json' }),
      '{}',
    )

    await expect(response.json()).resolves.toEqual({ data: [] })
    expect(warnSpy).toHaveBeenCalledWith(
      'Buffered CapacitorHttp request returned status 0; retrying through native HTTP',
    )
    warnSpy.mockRestore()
  })
})
