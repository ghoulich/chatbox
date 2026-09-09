import type { Settings } from '@shared/types'
import { ComfyUIRequestError, requestComfyUIJson } from './client'
import type { ComfyUIWorkflowProfile } from './workflows'

type ComfyUISettings = Settings['comfyui']
type JsonObject = Record<string, unknown>

export interface BridgeHealth {
  ok: boolean
  version: string
  maxWorkflowBytes: number
}

export interface BridgeWorkflowMetadata {
  id: string
  name: string
  revision: number
  updatedAt?: string
  contentHash?: string
  uiPath?: string
  capabilities?: ComfyUIWorkflowProfile['capabilities']
}

export interface BridgeUnmanagedWorkflow {
  path: string
  name: string
  size: number
  modified: number
}

export interface BridgeWorkflowBundle extends BridgeWorkflowMetadata {
  uiWorkflow: JsonObject
  apiWorkflow: JsonObject
  mapping: ComfyUIWorkflowProfile['inputMapping']
  capabilities: ComfyUIWorkflowProfile['capabilities']
}

export class BridgeRevisionConflictError extends Error {
  constructor(readonly current?: BridgeWorkflowMetadata) {
    super('The remote workflow changed')
    this.name = 'BridgeRevisionConflictError'
  }
}

function record(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined
}

function metadata(value: unknown): BridgeWorkflowMetadata | undefined {
  const item = record(value)
  if (typeof item?.id !== 'string' || typeof item.name !== 'string' || typeof item.revision !== 'number')
    return undefined
  return item as unknown as BridgeWorkflowMetadata
}

function bridgeError(error: unknown): never {
  if (error instanceof ComfyUIRequestError && error.status === 409) {
    throw new BridgeRevisionConflictError(metadata(record(error.payload)?.current))
  }
  throw error
}

export async function checkWorkflowBridge(settings: ComfyUISettings, signal?: AbortSignal): Promise<BridgeHealth> {
  const result = record(await requestComfyUIJson(settings, '/chatbox-bridge/v1/health', { signal }))
  if (result?.ok !== true || typeof result.version !== 'string' || typeof result.maxWorkflowBytes !== 'number') {
    throw new Error('ComfyUI Workflow Bridge returned an invalid health response')
  }
  return result as unknown as BridgeHealth
}

export async function listBridgeWorkflows(
  settings: ComfyUISettings,
  signal?: AbortSignal
): Promise<{ workflows: BridgeWorkflowMetadata[]; unmanaged: BridgeUnmanagedWorkflow[] }> {
  const result = record(await requestComfyUIJson(settings, '/chatbox-bridge/v1/workflows', { signal }))
  if (!result || !Array.isArray(result.workflows) || !Array.isArray(result.unmanaged)) {
    throw new Error('ComfyUI Workflow Bridge returned an invalid workflow list')
  }
  return {
    workflows: result.workflows.map(metadata).filter((item): item is BridgeWorkflowMetadata => Boolean(item)),
    unmanaged: result.unmanaged.filter((item): item is BridgeUnmanagedWorkflow => {
      const value = record(item)
      return (
        typeof value?.path === 'string' &&
        typeof value.name === 'string' &&
        typeof value.size === 'number' &&
        typeof value.modified === 'number'
      )
    }),
  }
}

export async function getBridgeWorkflow(
  settings: ComfyUISettings,
  workflowId: string,
  signal?: AbortSignal
): Promise<BridgeWorkflowBundle> {
  const result = record(
    await requestComfyUIJson(settings, `/chatbox-bridge/v1/workflows/${encodeURIComponent(workflowId)}`, { signal })
  )
  if (
    !metadata(result) ||
    !record(result?.uiWorkflow) ||
    !record(result?.apiWorkflow) ||
    !record(result?.mapping) ||
    !record(result?.capabilities)
  ) {
    throw new Error('ComfyUI Workflow Bridge returned an invalid workflow')
  }
  return result as unknown as BridgeWorkflowBundle
}

export async function saveBridgeWorkflow(
  settings: ComfyUISettings,
  profile: ComfyUIWorkflowProfile,
  signal?: AbortSignal
): Promise<BridgeWorkflowBundle> {
  if (!profile.uiWorkflowJson?.trim()) throw new Error('This workflow has no ComfyUI UI graph to synchronize')
  const uiWorkflow = JSON.parse(profile.uiWorkflowJson) as unknown
  const apiWorkflow = JSON.parse(profile.apiWorkflowJson) as unknown
  const body = {
    id: profile.remote?.id,
    expectedRevision: profile.remote?.revision,
    name: profile.name,
    uiWorkflow,
    apiWorkflow,
    mapping: profile.inputMapping,
    capabilities: profile.capabilities,
  }
  try {
    return (await requestComfyUIJson(settings, '/chatbox-bridge/v1/workflows', {
      method: 'POST',
      body,
      signal,
    })) as BridgeWorkflowBundle
  } catch (error) {
    bridgeError(error)
  }
}

export async function deleteBridgeWorkflow(
  settings: ComfyUISettings,
  remote: NonNullable<ComfyUIWorkflowProfile['remote']>,
  signal?: AbortSignal
): Promise<void> {
  try {
    await requestComfyUIJson(
      settings,
      `/chatbox-bridge/v1/workflows/${encodeURIComponent(remote.id)}?expectedRevision=${remote.revision}`,
      { method: 'DELETE', signal }
    )
  } catch (error) {
    bridgeError(error)
  }
}

export function profileFromBridgeBundle(
  bundle: BridgeWorkflowBundle,
  existing?: ComfyUIWorkflowProfile,
  now = Date.now()
): ComfyUIWorkflowProfile {
  return {
    id: existing?.id ?? bundle.id,
    name: bundle.name,
    apiWorkflowJson: JSON.stringify(bundle.apiWorkflow, null, 2),
    uiWorkflowJson: JSON.stringify(bundle.uiWorkflow, null, 2),
    inputMapping: bundle.mapping ?? {},
    outputNodeId: existing?.outputNodeId,
    defaultNegativePrompt: existing?.defaultNegativePrompt,
    capabilities: bundle.capabilities ?? {
      textToImage: true,
      imageToImage: false,
      lora: false,
      controlNet: false,
    },
    builder: existing?.builder,
    remote: {
      id: bundle.id,
      revision: bundle.revision,
      contentHash: bundle.contentHash,
      updatedAt: bundle.updatedAt,
      uiPath: bundle.uiPath,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}
