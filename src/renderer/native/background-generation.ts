import { Capacitor, registerPlugin } from '@capacitor/core'

interface BackgroundGenerationPlugin {
  start(options: { taskId: string; maxDurationMs: number }): Promise<{ started: boolean }>
  stop(options: { taskId: string }): Promise<{ stopped: boolean }>
}

const BackgroundGeneration = registerPlugin<BackgroundGenerationPlugin>('BackgroundGeneration')

export type BackgroundGenerationState = 'idle' | 'starting' | 'active' | 'unavailable'

export interface BackgroundGenerationStatus {
  state: BackgroundGenerationState
  activeCount: number
  lastError?: string
}

const activeTasks = new Set<string>()
const startingTasks = new Set<string>()
const statusListeners = new Set<() => void>()
let lastError: string | undefined
let statusSnapshot: BackgroundGenerationStatus = { state: 'idle', activeCount: 0 }

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function publishStatus() {
  const state: BackgroundGenerationState = activeTasks.size
    ? 'active'
    : startingTasks.size
      ? 'starting'
      : lastError
        ? 'unavailable'
        : 'idle'
  statusSnapshot = { state, activeCount: activeTasks.size, lastError }
  statusListeners.forEach((listener) => listener())
}

export function getBackgroundGenerationStatus(): BackgroundGenerationStatus {
  return statusSnapshot
}

export function subscribeBackgroundGenerationStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export async function startBackgroundGeneration(taskId: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return
  startingTasks.add(taskId)
  publishStatus()
  try {
    await BackgroundGeneration.start({ taskId, maxDurationMs: 30 * 60 * 1000 })
    startingTasks.delete(taskId)
    activeTasks.add(taskId)
    lastError = undefined
    publishStatus()
  } catch (error) {
    startingTasks.delete(taskId)
    lastError = errorMessage(error)
    publishStatus()
    throw error
  }
}

export async function stopBackgroundGeneration(taskId: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return
  try {
    await BackgroundGeneration.stop({ taskId })
  } finally {
    startingTasks.delete(taskId)
    activeTasks.delete(taskId)
    publishStatus()
  }
}
