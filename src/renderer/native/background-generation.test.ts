import { beforeEach, describe, expect, test, vi } from 'vitest'

const { nativeStartMock, nativeStopMock } = vi.hoisted(() => ({
  nativeStartMock: vi.fn(),
  nativeStopMock: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  },
  registerPlugin: () => ({ start: nativeStartMock, stop: nativeStopMock }),
}))

describe('background generation status', () => {
  beforeEach(() => {
    vi.resetModules()
    nativeStartMock.mockReset()
    nativeStopMock.mockReset()
  })

  test('reports starting only until Android confirms the foreground service, then active and idle', async () => {
    let confirmStart: ((value: { started: boolean }) => void) | undefined
    nativeStartMock.mockImplementationOnce(
      () =>
        new Promise<{ started: boolean }>((resolve) => {
          confirmStart = resolve
        })
    )
    nativeStopMock.mockResolvedValueOnce({ stopped: true })
    const background = await import('./background-generation')

    const startPromise = background.startBackgroundGeneration('task-1')
    expect(background.getBackgroundGenerationStatus()).toEqual({ state: 'starting', activeCount: 0 })

    confirmStart?.({ started: true })
    await startPromise
    expect(background.getBackgroundGenerationStatus()).toEqual({ state: 'active', activeCount: 1 })

    await background.stopBackgroundGeneration('task-1')
    expect(background.getBackgroundGenerationStatus()).toEqual({ state: 'idle', activeCount: 0 })
  })

  test('retains a visible unavailable state and the Android failure reason', async () => {
    nativeStartMock.mockRejectedValueOnce(new Error('Android rejected the foreground service notification'))
    const background = await import('./background-generation')

    await expect(background.startBackgroundGeneration('task-2')).rejects.toThrow('Android rejected')
    expect(background.getBackgroundGenerationStatus()).toEqual({
      state: 'unavailable',
      activeCount: 0,
      lastError: 'Android rejected the foreground service notification',
    })
  })
})
