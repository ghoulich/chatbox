import { describe, expect, it, vi } from 'vitest'
import type { Settings } from '@shared/types'
import {
  activateWorkflow,
  buildTextToImageWorkflow,
  createTextToImageProfile,
  DEFAULT_COMFYUI_BUILDER,
  ensureWorkflowLibrary,
  getComfyUIRuntimeDefaults,
  getComfyUIRuntimeParameterDescriptors,
  recommendComfyUIWorkflow,
  removeWorkflow,
  upsertAndActivateWorkflow,
} from './workflows'

const baseSettings = {
  enabled: true,
  endpoint: 'http://127.0.0.1:8188',
  userId: '',
  workflowProfiles: [],
  activeWorkflowId: undefined,
  workflowName: 'Legacy SD',
  workflowJson: '{"1":{"class_type":"KSampler","inputs":{}}}',
  inputMapping: { positivePrompt: '1.text' },
  outputNodeId: '9',
  defaultNegativePrompt: 'blurry',
  defaultWidth: 512,
  defaultHeight: 512,
  timeoutSeconds: 600,
  pollIntervalMs: 1000,
} satisfies Settings['comfyui']

const builder = {
  ...DEFAULT_COMFYUI_BUILDER,
  checkpoint: 'v1-5.safetensors',
  width: 768,
  height: 512,
  sampler: 'dpmpp_2m',
  scheduler: 'karras',
  steps: 28,
  cfg: 6.5,
  seed: -1,
}

describe('ComfyUI workflow builder', () => {
  it('creates paired API and UI graphs with matching standard node parameters', () => {
    const { apiWorkflow, uiWorkflow } = buildTextToImageWorkflow(builder)
    const api = apiWorkflow as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    const ui = uiWorkflow as { nodes: Array<{ id: number; type: string; widgets_values: unknown[] }>; links: unknown[] }

    expect(api['4']).toMatchObject({ class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: builder.checkpoint } })
    expect(api['5'].inputs).toMatchObject({ width: 768, height: 512, batch_size: 1 })
    expect(api['3'].inputs).toMatchObject({ steps: 28, cfg: 6.5, sampler_name: 'dpmpp_2m', scheduler: 'karras' })
    expect(ui.nodes.find((node) => node.id === 4)?.widgets_values).toEqual([builder.checkpoint])
    expect(ui.nodes.find((node) => node.id === 5)?.widgets_values).toEqual([768, 512, 1])
    expect(ui.links).toHaveLength(9)
  })

  it('creates a profile whose API mappings are ready for generation', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
    const profile = createTextToImageProfile('My SD workflow', builder, 123)

    expect(profile).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'My SD workflow',
      outputNodeId: '9',
      createdAt: 123,
      updatedAt: 123,
      inputMapping: { positivePrompt: '6.text', checkpoint: '4.ckpt_name' },
    })
    expect(JSON.parse(profile.apiWorkflowJson)).toHaveProperty('9.class_type', 'SaveImage')
    expect(JSON.parse(profile.uiWorkflowJson!)).toHaveProperty('version', 0.4)
  })

  it('creates an executable image-to-image graph with a reference image mapping', () => {
    const profile = createTextToImageProfile('Img2Img', { ...builder, mode: 'image-to-image', denoise: 0.6 }, 123)
    const api = JSON.parse(profile.apiWorkflowJson) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >

    expect(api['5']).toBeUndefined()
    expect(api['11']).toMatchObject({ class_type: 'LoadImage' })
    expect(api['12']).toMatchObject({ class_type: 'VAEEncode' })
    expect(api['3'].inputs).toMatchObject({ latent_image: ['12', 0], denoise: 0.6 })
    expect(profile.inputMapping).toMatchObject({ image: '11.image', denoise: '3.denoise' })
    expect(profile.capabilities.imageToImage).toBe(true)
  })

  it('adds LoRA nodes to both the model and CLIP paths', () => {
    const { apiWorkflow } = buildTextToImageWorkflow({
      ...builder,
      loraName: 'detail.safetensors',
      loraStrength: 0.8,
    })
    const api = apiWorkflow as Record<string, { class_type: string; inputs: Record<string, unknown> }>

    expect(api['10']).toMatchObject({
      class_type: 'LoraLoader',
      inputs: { lora_name: 'detail.safetensors', strength_model: 0.8, strength_clip: 0.8 },
    })
    expect(api['3'].inputs.model).toEqual(['10', 0])
    expect(api['6'].inputs.clip).toEqual(['10', 1])
    expect(api['7'].inputs.clip).toEqual(['10', 1])
  })

  it('creates a ControlNet graph whose conditioned prompts feed the sampler', () => {
    const profile = createTextToImageProfile(
      'ControlNet',
      { ...builder, mode: 'controlnet', controlNetName: 'canny.safetensors', controlNetStrength: 0.9 },
      123
    )
    const api = JSON.parse(profile.apiWorkflowJson) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >

    expect(api['11']).toMatchObject({ class_type: 'LoadImage' })
    expect(api['12']).toMatchObject({ class_type: 'ControlNetLoader' })
    expect(api['13']).toMatchObject({
      class_type: 'ControlNetApplyAdvanced',
      inputs: { strength: 0.9, control_net: ['12', 0], image: ['11', 0] },
    })
    expect(api['3'].inputs).toMatchObject({ positive: ['13', 0], negative: ['13', 1] })
    expect(profile.capabilities).toMatchObject({ imageToImage: true, controlNet: true })
  })
})

describe('ComfyUI workflow library compatibility', () => {
  it('migrates the legacy single workflow without changing its generation fields', () => {
    const migrated = ensureWorkflowLibrary(baseSettings, 100)
    expect(migrated.workflowProfiles).toHaveLength(1)
    expect(migrated.workflowProfiles[0]).toMatchObject({
      id: 'legacy-comfyui-workflow',
      name: 'Legacy SD',
      apiWorkflowJson: baseSettings.workflowJson,
      createdAt: 100,
    })
    expect(migrated.workflowJson).toBe(baseSettings.workflowJson)
    expect(migrated.activeWorkflowId).toBe('legacy-comfyui-workflow')
  })

  it('activates, replaces, and removes profiles while mirroring legacy generation fields', () => {
    const first = createTextToImageProfile('First', builder, 1)
    const second = createTextToImageProfile('Second', { ...builder, width: 1024 }, 2)
    let settings = upsertAndActivateWorkflow({ ...baseSettings, workflowProfiles: [] }, first)
    settings = upsertAndActivateWorkflow(settings, second)
    settings = activateWorkflow(settings, first.id)
    expect(settings.workflowName).toBe('First')
    expect(settings.workflowJson).toBe(first.apiWorkflowJson)

    settings = removeWorkflow(settings, first.id)
    expect(settings.activeWorkflowId).toBe(second.id)
    expect(settings.workflowName).toBe('Second')
  })
})

describe('ComfyUI mobile runtime controls', () => {
  it('derives reproducible defaults and supported fields from a generated workflow', () => {
    const profile = createTextToImageProfile('Runtime', { ...builder, loraName: 'detail.safetensors' }, 1)
    expect(getComfyUIRuntimeDefaults(profile)).toMatchObject({
      width: 768,
      height: 512,
      steps: 28,
      cfg: 6.5,
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      loraStrength: 1,
    })
    expect(getComfyUIRuntimeParameterDescriptors(profile).map((item) => item.key)).toEqual(
      expect.arrayContaining(['width', 'height', 'steps', 'cfg', 'seed', 'sampler', 'scheduler', 'loraStrength'])
    )
  })

  it('recommends a capability-compatible workflow when the active workflow cannot accept the input', () => {
    const text = createTextToImageProfile('Text', builder, 1)
    const image = createTextToImageProfile('Image', { ...builder, mode: 'image-to-image' }, 2)
    expect(recommendComfyUIWorkflow([text, image], 1, text.id)?.id).toBe(image.id)
    expect(recommendComfyUIWorkflow([text, image], 0, image.id)?.id).toBe(text.id)
  })
})
