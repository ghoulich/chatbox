import type { ComfyUIRuntimeParameters, Settings } from '@shared/types'

export type ComfyUISettings = Settings['comfyui']
export type ComfyUIWorkflowProfile = ComfyUISettings['workflowProfiles'][number]
export type ComfyUIWorkflowBuilder = NonNullable<ComfyUIWorkflowProfile['builder']>

export const DEFAULT_COMFYUI_BUILDER: ComfyUIWorkflowBuilder = {
  mode: 'text-to-image',
  checkpoint: '',
  width: 512,
  height: 512,
  sampler: 'euler',
  scheduler: 'normal',
  steps: 20,
  cfg: 7,
  seed: -1,
  denoise: 0.75,
  loraName: undefined,
  loraStrength: 1,
  controlNetName: undefined,
  controlNetStrength: 1,
  controlNetStart: 0,
  controlNetEnd: 1,
}

export const COMFYUI_SAMPLERS = [
  'euler',
  'euler_ancestral',
  'heun',
  'dpm_2',
  'dpm_2_ancestral',
  'lms',
  'dpmpp_2m',
  'dpmpp_2m_sde',
  'dpmpp_sde',
] as const

export const COMFYUI_SCHEDULERS = ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform'] as const

export type ComfyUIRuntimeParameterKey = keyof ComfyUIRuntimeParameters

export interface ComfyUIRuntimeParameterDescriptor {
  key: ComfyUIRuntimeParameterKey
  group: 'basic' | 'advanced'
  minimum?: number
  maximum?: number
  step?: number
  options?: readonly string[]
}

export function getComfyUIRuntimeDefaults(profile?: ComfyUIWorkflowProfile): ComfyUIRuntimeParameters {
  const builder = profile?.builder
  if (!builder) return {}
  return {
    ...(builder.mode === 'image-to-image' ? {} : { width: builder.width, height: builder.height }),
    steps: builder.steps,
    cfg: builder.cfg,
    seed: builder.seed,
    sampler: builder.sampler,
    scheduler: builder.scheduler,
    ...(builder.mode === 'image-to-image' ? { denoise: builder.denoise } : {}),
    ...(builder.loraName ? { loraStrength: builder.loraStrength } : {}),
    ...(builder.mode === 'controlnet'
      ? {
          controlNetStrength: builder.controlNetStrength,
          controlNetStart: builder.controlNetStart,
          controlNetEnd: builder.controlNetEnd,
        }
      : {}),
  }
}

export function getComfyUIRuntimeParameterDescriptors(
  profile?: ComfyUIWorkflowProfile
): ComfyUIRuntimeParameterDescriptor[] {
  if (!profile) return []
  const builder = profile.builder
  const mapping = profile.inputMapping
  const result: ComfyUIRuntimeParameterDescriptor[] = []
  const available = (key: keyof typeof mapping) => Boolean(builder || mapping[key])
  if (builder?.mode !== 'image-to-image' && available('width')) {
    result.push(
      { key: 'width', group: 'basic', minimum: 64, maximum: 8192, step: 64 },
      { key: 'height', group: 'basic', minimum: 64, maximum: 8192, step: 64 }
    )
  }
  if (available('steps')) result.push({ key: 'steps', group: 'basic', minimum: 1, maximum: 150, step: 1 })
  if (available('cfg')) result.push({ key: 'cfg', group: 'basic', minimum: 0, maximum: 100, step: 0.5 })
  if (available('seed')) result.push({ key: 'seed', group: 'basic', minimum: -1, step: 1 })
  if (builder?.mode === 'image-to-image' || mapping.denoise) {
    result.push({ key: 'denoise', group: 'basic', minimum: 0, maximum: 1, step: 0.05 })
  }
  if (available('sampler')) result.push({ key: 'sampler', group: 'advanced', options: COMFYUI_SAMPLERS })
  if (available('scheduler')) result.push({ key: 'scheduler', group: 'advanced', options: COMFYUI_SCHEDULERS })
  if (builder?.loraName || mapping.loraStrengthModel || mapping.loraStrengthClip) {
    result.push({ key: 'loraStrength', group: 'advanced', minimum: -10, maximum: 10, step: 0.05 })
  }
  if (builder?.mode === 'controlnet' || mapping.controlNetStrength) {
    result.push(
      { key: 'controlNetStrength', group: 'advanced', minimum: 0, maximum: 10, step: 0.05 },
      { key: 'controlNetStart', group: 'advanced', minimum: 0, maximum: 1, step: 0.05 },
      { key: 'controlNetEnd', group: 'advanced', minimum: 0, maximum: 1, step: 0.05 }
    )
  }
  return result
}

export function recommendComfyUIWorkflow(
  profiles: ComfyUIWorkflowProfile[],
  referenceImageCount: number,
  activeWorkflowId?: string
): ComfyUIWorkflowProfile | undefined {
  const active = profiles.find((profile) => profile.id === activeWorkflowId)
  const acceptsInput = (profile: ComfyUIWorkflowProfile) =>
    referenceImageCount > 0 ? profile.capabilities.imageToImage : profile.capabilities.textToImage
  if (active && acceptsInput(active)) return active
  return profiles.find(acceptsInput)
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `workflow-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

type ApiNode = { class_type: string; inputs: Record<string, unknown> }

const nodeSockets: Record<string, { inputs: Array<[string, string]>; outputs: string[] }> = {
  CheckpointLoaderSimple: { inputs: [], outputs: ['MODEL', 'CLIP', 'VAE'] },
  LoraLoader: {
    inputs: [
      ['model', 'MODEL'],
      ['clip', 'CLIP'],
    ],
    outputs: ['MODEL', 'CLIP'],
  },
  CLIPTextEncode: { inputs: [['clip', 'CLIP']], outputs: ['CONDITIONING'] },
  EmptyLatentImage: { inputs: [], outputs: ['LATENT'] },
  LoadImage: { inputs: [], outputs: ['IMAGE', 'MASK'] },
  VAEEncode: {
    inputs: [
      ['pixels', 'IMAGE'],
      ['vae', 'VAE'],
    ],
    outputs: ['LATENT'],
  },
  ControlNetLoader: { inputs: [], outputs: ['CONTROL_NET'] },
  ControlNetApplyAdvanced: {
    inputs: [
      ['positive', 'CONDITIONING'],
      ['negative', 'CONDITIONING'],
      ['control_net', 'CONTROL_NET'],
      ['image', 'IMAGE'],
    ],
    outputs: ['CONDITIONING', 'CONDITIONING'],
  },
  KSampler: {
    inputs: [
      ['model', 'MODEL'],
      ['positive', 'CONDITIONING'],
      ['negative', 'CONDITIONING'],
      ['latent_image', 'LATENT'],
    ],
    outputs: ['LATENT'],
  },
  VAEDecode: {
    inputs: [
      ['samples', 'LATENT'],
      ['vae', 'VAE'],
    ],
    outputs: ['IMAGE'],
  },
  SaveImage: { inputs: [['images', 'IMAGE']], outputs: [] },
}

function widgetValues(node: ApiNode): unknown[] {
  const input = node.inputs
  switch (node.class_type) {
    case 'CheckpointLoaderSimple':
      return [input.ckpt_name]
    case 'LoraLoader':
      return [input.lora_name, input.strength_model, input.strength_clip]
    case 'CLIPTextEncode':
      return [input.text]
    case 'EmptyLatentImage':
      return [input.width, input.height, input.batch_size]
    case 'LoadImage':
      return [input.image, 'image']
    case 'ControlNetLoader':
      return [input.control_net_name]
    case 'ControlNetApplyAdvanced':
      return [input.strength, input.start_percent, input.end_percent]
    case 'KSampler':
      return [input.seed, 'randomize', input.steps, input.cfg, input.sampler_name, input.scheduler, input.denoise]
    case 'SaveImage':
      return [input.filename_prefix]
    default:
      return []
  }
}

function nodePosition(id: number, type: string): [number, number] {
  const positions: Record<string, [number, number]> = {
    CheckpointLoaderSimple: [20, 300],
    LoraLoader: [380, 300],
    CLIPTextEncode: [740, id === 6 ? 80 : 350],
    EmptyLatentImage: [760, 650],
    LoadImage: [700, 650],
    VAEEncode: [1080, 650],
    ControlNetLoader: [350, 650],
    ControlNetApplyAdvanced: [1120, 250],
    KSampler: [1480, 300],
    VAEDecode: [1850, 300],
    SaveImage: [2120, 280],
  }
  return positions[type] ?? [id * 120, 300]
}

function buildUiWorkflow(apiWorkflow: Record<string, ApiNode>): Record<string, unknown> {
  const entries = Object.entries(apiWorkflow).sort(([left], [right]) => Number(left) - Number(right))
  const uiNodes = entries.map(([id, apiNode], order) => {
    const sockets = nodeSockets[apiNode.class_type] ?? { inputs: [], outputs: [] }
    return {
      id: Number(id),
      type: apiNode.class_type,
      pos: nodePosition(Number(id), apiNode.class_type),
      size:
        apiNode.class_type === 'CLIPTextEncode'
          ? [400, 200]
          : apiNode.class_type === 'KSampler'
            ? [315, 262]
            : [315, 110],
      flags: {},
      order,
      mode: 0,
      inputs: sockets.inputs.map(([name, type]) => ({ name, type, link: null as number | null })),
      outputs: sockets.outputs.map((type, slot) => ({ name: type, type, links: [] as number[], slot_index: slot })),
      properties: { 'Node name for S&R': apiNode.class_type },
      widgets_values: widgetValues(apiNode),
    }
  })
  const byId = new Map(uiNodes.map((item) => [String(item.id), item]))
  const links: unknown[][] = []
  let linkId = 0
  for (const [targetId, apiNode] of entries) {
    for (const [inputName, value] of Object.entries(apiNode.inputs)) {
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'number')
        continue
      const source = byId.get(value[0])
      const target = byId.get(targetId)
      const inputSlot = target?.inputs.findIndex((item) => item.name === inputName) ?? -1
      const output = source?.outputs[value[1]]
      if (!source || !target || inputSlot < 0 || !output) continue
      linkId += 1
      target.inputs[inputSlot].link = linkId
      output.links.push(linkId)
      links.push([linkId, source.id, value[1], target.id, inputSlot, target.inputs[inputSlot].type])
    }
  }
  return {
    last_node_id: Math.max(...uiNodes.map((item) => item.id)),
    last_link_id: linkId,
    nodes: uiNodes,
    links,
    groups: [],
    config: {},
    extra: { ds: { scale: 0.65, offset: [70, 80] } },
    version: 0.4,
  }
}

/** Builds matching API and UI workflows so the result works in ChatBox and opens in ComfyUI. */
export function buildTextToImageWorkflow(builder: ComfyUIWorkflowBuilder): {
  apiWorkflow: Record<string, unknown>
  uiWorkflow: Record<string, unknown>
} {
  const seed = builder.seed >= 0 ? builder.seed : 1
  const apiWorkflow: Record<string, ApiNode> = {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: builder.steps,
        cfg: builder.cfg,
        sampler_name: builder.sampler,
        scheduler: builder.scheduler,
        denoise: builder.mode === 'image-to-image' ? builder.denoise : 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: builder.checkpoint } },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: builder.width, height: builder.height, batch_size: 1 },
    },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'Chatbox', images: ['8', 0] } },
  }

  let modelSource: [string, number] = ['4', 0]
  let clipSource: [string, number] = ['4', 1]
  if (builder.loraName) {
    apiWorkflow['10'] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: builder.loraName,
        strength_model: builder.loraStrength,
        strength_clip: builder.loraStrength,
        model: ['4', 0],
        clip: ['4', 1],
      },
    }
    modelSource = ['10', 0]
    clipSource = ['10', 1]
  }
  apiWorkflow['3'].inputs.model = modelSource
  apiWorkflow['6'].inputs.clip = clipSource
  apiWorkflow['7'].inputs.clip = clipSource

  if (builder.mode === 'image-to-image') {
    delete apiWorkflow['5']
    apiWorkflow['11'] = { class_type: 'LoadImage', inputs: { image: 'chatbox-input.png' } }
    apiWorkflow['12'] = {
      class_type: 'VAEEncode',
      inputs: { pixels: ['11', 0], vae: ['4', 2] },
    }
    apiWorkflow['3'].inputs.latent_image = ['12', 0]
  } else if (builder.mode === 'controlnet') {
    apiWorkflow['11'] = { class_type: 'LoadImage', inputs: { image: 'chatbox-control.png' } }
    apiWorkflow['12'] = {
      class_type: 'ControlNetLoader',
      inputs: { control_net_name: builder.controlNetName ?? '' },
    }
    apiWorkflow['13'] = {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        strength: builder.controlNetStrength,
        start_percent: builder.controlNetStart,
        end_percent: builder.controlNetEnd,
        positive: ['6', 0],
        negative: ['7', 0],
        control_net: ['12', 0],
        image: ['11', 0],
      },
    }
    apiWorkflow['3'].inputs.positive = ['13', 0]
    apiWorkflow['3'].inputs.negative = ['13', 1]
  }

  const uiWorkflow = buildUiWorkflow(apiWorkflow)
  return { apiWorkflow, uiWorkflow }
}

export function createTextToImageProfile(
  name: string,
  builder: ComfyUIWorkflowBuilder,
  now = Date.now()
): ComfyUIWorkflowProfile {
  const built = buildTextToImageWorkflow(builder)
  return {
    id: newId(),
    name: name.trim(),
    apiWorkflowJson: JSON.stringify(built.apiWorkflow, null, 2),
    uiWorkflowJson: JSON.stringify(built.uiWorkflow, null, 2),
    inputMapping: {
      positivePrompt: '6.text',
      negativePrompt: '7.text',
      checkpoint: '4.ckpt_name',
      width: builder.mode === 'image-to-image' ? undefined : '5.width',
      height: builder.mode === 'image-to-image' ? undefined : '5.height',
      seed: '3.seed',
      steps: '3.steps',
      cfg: '3.cfg',
      sampler: '3.sampler_name',
      scheduler: '3.scheduler',
      batchSize: builder.mode === 'image-to-image' ? undefined : '5.batch_size',
      image: builder.mode === 'text-to-image' ? undefined : '11.image',
      denoise: '3.denoise',
      loraStrengthModel: builder.loraName ? '10.strength_model' : undefined,
      loraStrengthClip: builder.loraName ? '10.strength_clip' : undefined,
      controlNetStrength: builder.mode === 'controlnet' ? '13.strength' : undefined,
      controlNetStart: builder.mode === 'controlnet' ? '13.start_percent' : undefined,
      controlNetEnd: builder.mode === 'controlnet' ? '13.end_percent' : undefined,
    },
    outputNodeId: '9',
    capabilities: {
      textToImage: builder.mode === 'text-to-image',
      imageToImage: builder.mode !== 'text-to-image',
      lora: Boolean(builder.loraName),
      controlNet: builder.mode === 'controlnet',
    },
    builder: { ...builder },
    createdAt: now,
    updatedAt: now,
  }
}

export function createImportedWorkflowProfile(
  name: string,
  apiWorkflowJson: string,
  inputMapping: ComfyUIWorkflowProfile['inputMapping'] = {},
  now = Date.now()
): ComfyUIWorkflowProfile {
  return {
    id: newId(),
    name: name.trim() || 'ComfyUI Workflow',
    apiWorkflowJson,
    inputMapping: { ...inputMapping },
    capabilities: { textToImage: true, imageToImage: false, lora: false, controlNet: false },
    createdAt: now,
    updatedAt: now,
  }
}

export function legacyWorkflowProfile(settings: ComfyUISettings, now = Date.now()): ComfyUIWorkflowProfile | undefined {
  if (!settings.workflowJson.trim()) return undefined
  return {
    id: 'legacy-comfyui-workflow',
    name: settings.workflowName.trim() || 'ComfyUI Workflow',
    apiWorkflowJson: settings.workflowJson,
    inputMapping: { ...settings.inputMapping },
    outputNodeId: settings.outputNodeId,
    defaultNegativePrompt: settings.defaultNegativePrompt,
    capabilities: { textToImage: true, imageToImage: false, lora: false, controlNet: false },
    createdAt: now,
    updatedAt: now,
  }
}

export function ensureWorkflowLibrary(settings: ComfyUISettings, now = Date.now()): ComfyUISettings {
  if (settings.workflowProfiles.length > 0 || !settings.workflowJson.trim()) return settings
  const profile = legacyWorkflowProfile(settings, now)
  return profile ? { ...settings, workflowProfiles: [profile], activeWorkflowId: profile.id } : settings
}

export function activateWorkflow(settings: ComfyUISettings, profileId: string): ComfyUISettings {
  const profile = settings.workflowProfiles.find((item) => item.id === profileId)
  if (!profile) return settings
  return {
    ...settings,
    activeWorkflowId: profile.id,
    workflowName: profile.name,
    workflowJson: profile.apiWorkflowJson,
    inputMapping: { ...profile.inputMapping },
    outputNodeId: profile.outputNodeId,
    defaultNegativePrompt: profile.defaultNegativePrompt,
  }
}

export function upsertAndActivateWorkflow(settings: ComfyUISettings, profile: ComfyUIWorkflowProfile): ComfyUISettings {
  const index = settings.workflowProfiles.findIndex((item) => item.id === profile.id)
  const workflowProfiles = [...settings.workflowProfiles]
  if (index < 0) workflowProfiles.push(profile)
  else workflowProfiles[index] = profile
  return activateWorkflow({ ...settings, workflowProfiles }, profile.id)
}

export function removeWorkflow(settings: ComfyUISettings, profileId: string): ComfyUISettings {
  const workflowProfiles = settings.workflowProfiles.filter((item) => item.id !== profileId)
  if (settings.activeWorkflowId !== profileId) return { ...settings, workflowProfiles }
  const next = workflowProfiles[0]
  if (!next) {
    return {
      ...settings,
      workflowProfiles,
      activeWorkflowId: undefined,
      workflowName: 'ComfyUI Workflow',
      workflowJson: '',
      inputMapping: {},
      outputNodeId: undefined,
      defaultNegativePrompt: undefined,
    }
  }
  return activateWorkflow({ ...settings, workflowProfiles, activeWorkflowId: next.id }, next.id)
}
