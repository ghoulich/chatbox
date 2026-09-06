import { SettingsService, type SettingsStoragePort } from '@chatbox/core'
import { describe, expect, test } from 'vitest'
import { createSettingsStore } from './createSettingsStore'

class MemorySettingsStorage implements SettingsStoragePort {
  value: unknown = null

  read() {
    return Promise.resolve(this.value)
  }

  write(value: unknown) {
    this.value = value
    return Promise.resolve()
  }

  remove() {
    this.value = null
    return Promise.resolve()
  }
}

describe('createSettingsStore', () => {
  test('projects hydration and routes compatibility setState through SettingsService', async () => {
    const storage = new MemorySettingsStorage()
    const service = new SettingsService(storage, { isDesktopLike: false })
    const store = createSettingsStore(service)

    await store.getState().hydrate()
    expect(store.getState().hydrationStatus).toBe('hydrated')

    store.setState({ language: 'ja' })
    store.setState((state) => {
      state.showWordCount = true
    })
    store.getState().setSettings((settings) => {
      settings.theme = 1
    })
    await service.flushPersistence()

    expect(service.getSettings()).toMatchObject({
      language: 'ja',
      showWordCount: true,
      theme: 1,
    })
    expect(storage.value).toMatchObject({
      language: 'ja',
      showWordCount: true,
      theme: 1,
      __version: 6,
    })

    store.getState().destroy()
    service.dispose()
  })

  test('preserves store actions when a settings screen spreads the complete state', () => {
    const storage = new MemorySettingsStorage()
    const service = new SettingsService(storage, { isDesktopLike: false })
    const store = createSettingsStore(service)
    const state = store.getState()

    state.setSettings({
      ...state,
      backgroundGenerationEnabled: !state.backgroundGenerationEnabled,
    })

    expect(store.getState().backgroundGenerationEnabled).toBe(!state.backgroundGenerationEnabled)
    expect(store.getState().getSettings).toBeTypeOf('function')
    expect(store.getState().setSettings).toBeTypeOf('function')
    expect(store.getState().hydrate).toBeTypeOf('function')
    expect(store.getState().destroy).toBeTypeOf('function')
    expect(Object.prototype.hasOwnProperty.call(service.getSettings(), 'getSettings')).toBe(false)

    store.getState().destroy()
    service.dispose()
  })
})
