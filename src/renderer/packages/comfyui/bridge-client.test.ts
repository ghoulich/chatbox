import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '@shared/types'
import { ComfyUIRequestError, requestComfyUIJson } from './client'
import {
  BridgeRevisionConflictError,
  checkWorkflowBridge,
  getBridgeWorkflow,
  listBridgeWorkflows,
  profileFromBridgeBundle,
  saveBridgeWorkflow,
} from './bridge-client'

vi.mock('./client', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('./client')>()
  return { ...original, requestComfyUIJson: vi.fn() }
})

const settings = {
  enabled: true,
  endpoint: 'https://comfy.example',
  workflowProfiles: [],
  workflowName: '',
  workflowJson: '',
  inputMapping: {},
  defaultWidth: 512,
  defaultHeight: 512,
  timeoutSeconds: 600,
  pollIntervalMs: 1000,
} satisfies Settings['comfyui']

const bundle = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'SD 1.5',
  revision: 2,
  updatedAt: '2026-09-09T00:00:00Z',
  contentHash: 'abc',
  uiPath: 'workflows/Chatbox/SD--00000000.json',
  uiWorkflow: { nodes: [] },
  apiWorkflow: { '1': { class_type: 'KSampler', inputs: {} } },
  mapping: { positivePrompt: '6.text' },
  capabilities: { textToImage: true, imageToImage: false, lora: false, controlNet: false },
}

describe('ComfyUI Workflow Bridge client', () => {
  beforeEach(() => vi.mocked(requestComfyUIJson).mockReset())

  it('validates health and workflow list responses', async () => {
    vi.mocked(requestComfyUIJson)
      .mockResolvedValueOnce({ ok: true, version: '0.1.0', maxWorkflowBytes: 1024 })
      .mockResolvedValueOnce({
        workflows: [bundle],
        unmanaged: [{ path: 'workflows/a.json', name: 'a', size: 10, modified: 1 }],
      })

    await expect(checkWorkflowBridge(settings)).resolves.toEqual({ ok: true, version: '0.1.0', maxWorkflowBytes: 1024 })
    await expect(listBridgeWorkflows(settings)).resolves.toMatchObject({
      workflows: [{ revision: 2 }],
      unmanaged: [{ name: 'a' }],
    })
  })

  it('downloads a paired workflow and converts it to a local profile', async () => {
    vi.mocked(requestComfyUIJson).mockResolvedValueOnce(bundle)
    const downloaded = await getBridgeWorkflow(settings, bundle.id)
    const profile = profileFromBridgeBundle(downloaded, undefined, 123)

    expect(profile).toMatchObject({ id: bundle.id, name: 'SD 1.5', remote: { revision: 2 }, createdAt: 123 })
    expect(JSON.parse(profile.apiWorkflowJson)).toHaveProperty('1.class_type', 'KSampler')
  })

  it('sends both graph formats and translates revision conflicts', async () => {
    const profile = profileFromBridgeBundle(bundle, undefined, 123)
    vi.mocked(requestComfyUIJson).mockResolvedValueOnce(bundle)
    await saveBridgeWorkflow(settings, profile)
    expect(requestComfyUIJson).toHaveBeenCalledWith(
      settings,
      '/chatbox-bridge/v1/workflows',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ id: bundle.id, expectedRevision: 2, name: 'SD 1.5' }),
      })
    )

    vi.mocked(requestComfyUIJson).mockRejectedValueOnce(
      new ComfyUIRequestError('ComfyUI returned HTTP 409', 409, { current: bundle })
    )
    await expect(saveBridgeWorkflow(settings, profile)).rejects.toBeInstanceOf(BridgeRevisionConflictError)
  })

  it('refuses to upload an API-only workflow because ComfyUI could not open it as a graph', async () => {
    const profile = { ...profileFromBridgeBundle(bundle), uiWorkflowJson: undefined }
    await expect(saveBridgeWorkflow(settings, profile)).rejects.toThrow('no ComfyUI UI graph')
    expect(requestComfyUIJson).not.toHaveBeenCalled()
  })
})
