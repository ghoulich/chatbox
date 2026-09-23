import { CapacitorHttp } from '@capacitor/core'
import type { ComfyUIRuntimeParameters, ImageGenerationProgress, Settings } from '@shared/types'
import platform from '@/platform'
import { COMFYUI_WORKFLOW_MODEL_ID } from './constants'

type ComfyUISettings = Settings['comfyui']
type JsonRecord = Record<string, unknown>

export interface ComfyUIImageDescriptor {
  filename: string
  subfolder?: string
  type?: string
}

export interface ComfyUIGenerationOptions {
  prompt: string
  negativePrompt?: string
  checkpoint?: string
  referenceImage?: string
  aspectRatio?: string
  count?: number
  runtimeParameters?: ComfyUIRuntimeParameters
  signal?: AbortSignal
  onSubmitted?: (promptId: string) => void
  onProgress?: (progress: Omit<ImageGenerationProgress, 'updatedAt'>) => void
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export function normalizeComfyUIEndpoint(rawEndpoint: string): string {
  const value = rawEndpoint.trim()
  if (!value) throw new Error('ComfyUI endpoint is required')
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new Error('The ComfyUI endpoint is invalid')
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('The ComfyUI endpoint must use HTTP or HTTPS')
  }
  if (endpoint.username || endpoint.password) {
    throw new Error('ComfyUI endpoints containing credentials are not allowed')
  }
  endpoint.hash = ''
  endpoint.search = ''
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '')
  return endpoint.toString().replace(/\/$/, '')
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function buildComfyUIHeaders(settings: ComfyUISettings): Record<string, string> {
  const result: Record<string, string> = { Accept: 'application/json' }
  const username = settings.username?.trim() ?? ''
  const password = settings.password ?? ''
  if (username || password) {
    result.Authorization = `Basic ${encodeUtf8Base64(`${username}:${password}`)}`
  }
  const userId = settings.userId?.trim()
  if (userId) {
    if (/[\r\n]/.test(userId)) throw new Error('The ComfyUI user id is invalid')
    result['Comfy-User'] = userId
  }
  return result
}

export class ComfyUIRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown
  ) {
    super(message)
    this.name = 'ComfyUIRequestError'
  }
}

export async function requestComfyUIJson(
  settings: ComfyUISettings,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<unknown> {
  const url = `${normalizeComfyUIEndpoint(settings.endpoint)}${path}`
  const method = options.method ?? 'GET'
  const requestHeaders = buildComfyUIHeaders(settings)
  if (options.body !== undefined) requestHeaders['Content-Type'] = 'application/json'

  if (platform.type === 'mobile') {
    const response = await abortable(
      CapacitorHttp.request({
        url,
        method,
        headers: requestHeaders,
        data: options.body,
        responseType: 'json',
        connectTimeout: 15_000,
        readTimeout: Math.min(settings.timeoutSeconds * 1000, 120_000),
      }),
      options.signal
    )
    if (response.status < 200 || response.status >= 300) {
      throw new ComfyUIRequestError(`ComfyUI returned HTTP ${response.status}`, response.status, response.data)
    }
    return response.data
  }

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined)
    throw new ComfyUIRequestError(`ComfyUI returned HTTP ${response.status}`, response.status, payload)
  }
  return response.status === 204 ? undefined : response.json()
}

export async function checkComfyUIConnection(settings: ComfyUISettings, signal?: AbortSignal): Promise<void> {
  await requestComfyUIJson(settings, '/system_stats', { signal })
}

export async function loadComfyUICheckpoints(settings: ComfyUISettings, signal?: AbortSignal): Promise<string[]> {
  return loadComfyUIModelFolder(settings, 'checkpoints', signal)
}

async function loadComfyUIModelFolder(
  settings: ComfyUISettings,
  folder: 'checkpoints' | 'loras' | 'controlnet',
  signal?: AbortSignal
): Promise<string[]> {
  const payload = await requestComfyUIJson(settings, `/models/${folder}`, { signal })
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload)?.[folder])
      ? (asRecord(payload)?.[folder] as unknown[])
      : []
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

export async function loadComfyUILoras(settings: ComfyUISettings, signal?: AbortSignal): Promise<string[]> {
  return loadComfyUIModelFolder(settings, 'loras', signal)
}

export async function loadComfyUIControlNets(settings: ComfyUISettings, signal?: AbortSignal): Promise<string[]> {
  return loadComfyUIModelFolder(settings, 'controlnet', signal)
}

export interface ComfyUIModelRequirements {
  checkpoint?: string
  lora?: string
  controlNet?: string
}

function includesComfyUIModel(models: string[], required: string): boolean {
  const normalized = required.replace(/\\/g, '/').toLocaleLowerCase()
  return models.some((model) => model.replace(/\\/g, '/').toLocaleLowerCase() === normalized)
}

/** Checks only models explicitly referenced by the selected workflow before it enters the queue. */
export async function validateComfyUIModels(
  settings: ComfyUISettings,
  requirements: ComfyUIModelRequirements,
  signal?: AbortSignal
): Promise<string[]> {
  const checks: Array<Promise<{ required: string; models: string[] }>> = []
  if (requirements.checkpoint && requirements.checkpoint !== COMFYUI_WORKFLOW_MODEL_ID) {
    checks.push(
      loadComfyUICheckpoints(settings, signal).then((models) => ({
        required: requirements.checkpoint!,
        models,
      }))
    )
  }
  if (requirements.lora) {
    checks.push(loadComfyUILoras(settings, signal).then((models) => ({ required: requirements.lora!, models })))
  }
  if (requirements.controlNet) {
    checks.push(
      loadComfyUIControlNets(settings, signal).then((models) => ({ required: requirements.controlNet!, models }))
    )
  }
  const results = await Promise.all(checks)
  return results
    .filter(({ required, models }) => !includesComfyUIModel(models, required))
    .map(({ required }) => required)
}

export function parseComfyUIWorkflow(workflowJson: string): JsonRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(workflowJson)
  } catch {
    throw new Error('The ComfyUI workflow is not valid JSON')
  }
  const root = asRecord(parsed)
  const workflow = asRecord(root?.prompt) ?? root
  if (!workflow || Object.keys(workflow).length === 0) {
    throw new Error('The ComfyUI workflow must use API format')
  }
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!asRecord(node)?.inputs || !asRecord(asRecord(node)?.inputs)) {
      throw new Error(`ComfyUI workflow node ${nodeId} has no inputs object`)
    }
  }
  return structuredClone(workflow)
}

function nodeClass(node: unknown): string {
  const value = asRecord(node)?.class_type
  return typeof value === 'string' ? value : ''
}

function autoTarget(workflow: JsonRecord, kind: keyof ComfyUISettings['inputMapping']): string | undefined {
  const nodes = Object.entries(workflow)
  const byClass = (pattern: RegExp) => nodes.find(([, node]) => pattern.test(nodeClass(node)))?.[0]
  if (kind === 'positivePrompt' || kind === 'negativePrompt') {
    const textNodes = nodes.filter(([, node]) => /CLIPTextEncode/i.test(nodeClass(node)))
    const node = textNodes[kind === 'positivePrompt' ? 0 : 1]?.[0]
    return node ? `${node}.text` : undefined
  }
  if (kind === 'checkpoint') {
    const node = byClass(/CheckpointLoader/i)
    return node ? `${node}.ckpt_name` : undefined
  }
  if (kind === 'width' || kind === 'height' || kind === 'batchSize') {
    const node = byClass(/EmptyLatentImage/i)
    const input = kind === 'batchSize' ? 'batch_size' : kind
    return node ? `${node}.${input}` : undefined
  }
  if (kind === 'seed' || kind === 'steps' || kind === 'cfg' || kind === 'denoise') {
    const node = byClass(/KSampler/i)
    return node ? `${node}.${kind}` : undefined
  }
  if (kind === 'sampler' || kind === 'scheduler') {
    const node = byClass(/KSampler/i)
    return node ? `${node}.${kind === 'sampler' ? 'sampler_name' : 'scheduler'}` : undefined
  }
  if (kind === 'image') {
    const node = byClass(/LoadImage/i)
    return node ? `${node}.image` : undefined
  }
  if (kind === 'loraStrengthModel' || kind === 'loraStrengthClip') {
    const node = byClass(/LoraLoader/i)
    return node ? `${node}.${kind === 'loraStrengthModel' ? 'strength_model' : 'strength_clip'}` : undefined
  }
  if (kind === 'controlNetStrength' || kind === 'controlNetStart' || kind === 'controlNetEnd') {
    const node = byClass(/ControlNetApply/i)
    const input =
      kind === 'controlNetStrength' ? 'strength' : kind === 'controlNetStart' ? 'start_percent' : 'end_percent'
    return node ? `${node}.${input}` : undefined
  }
  return undefined
}

function applyInput(workflow: JsonRecord, target: string | undefined, value: unknown, required = false): void {
  if (!target || value === undefined) {
    if (required) throw new Error('The ComfyUI positive prompt mapping is missing')
    return
  }
  const separator = target.indexOf('.')
  if (separator <= 0 || separator === target.length - 1) {
    throw new Error(`Invalid ComfyUI input mapping: ${target}`)
  }
  const nodeId = target.slice(0, separator)
  const inputName = target.slice(separator + 1)
  const node = asRecord(workflow[nodeId])
  const inputs = asRecord(node?.inputs)
  if (!inputs) throw new Error(`ComfyUI input mapping references missing node: ${nodeId}`)
  if (!(inputName in inputs)) throw new Error(`ComfyUI node ${nodeId} has no input named ${inputName}`)
  inputs[inputName] = value
}

function dimensionTarget(
  workflow: JsonRecord,
  mapping: ComfyUISettings['inputMapping'],
  kind: 'width' | 'height'
): string | undefined {
  const explicit = mapping[kind]?.trim()
  if (explicit) return explicit
  const standard = autoTarget(workflow, kind)
  if (standard) return standard
  const generic = Object.entries(workflow).find(([, node]) => kind in (asRecord(asRecord(node)?.inputs) ?? {}))?.[0]
  return generic ? `${generic}.${kind}` : undefined
}

function dimensionInput(
  workflow: JsonRecord,
  target: string
): { inputs: JsonRecord; inputName: string; value: unknown } {
  const separator = target.indexOf('.')
  if (separator <= 0 || separator === target.length - 1) {
    throw new Error(`Invalid ComfyUI input mapping: ${target}`)
  }
  const nodeId = target.slice(0, separator)
  const inputName = target.slice(separator + 1)
  const inputs = asRecord(asRecord(workflow[nodeId])?.inputs)
  if (!inputs) throw new Error(`ComfyUI input mapping references missing node: ${nodeId}`)
  return { inputs, inputName, value: inputs[inputName] }
}

function hasConfiguredDimension(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  if (typeof value === 'string') return value.trim().length > 0 && Number.isFinite(Number(value)) && Number(value) > 0
  if (Array.isArray(value)) return value.length > 0
  return value !== null && typeof value === 'object'
}

function numericDimension(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

export function inspectComfyUIWorkflowDimensions(
  workflowJson: string,
  mapping: ComfyUISettings['inputMapping']
): { width?: number; height?: number; configured: boolean } {
  const workflow = parseComfyUIWorkflow(workflowJson)
  const widthTarget = dimensionTarget(workflow, mapping, 'width')
  const heightTarget = dimensionTarget(workflow, mapping, 'height')
  if (!widthTarget || !heightTarget) return { configured: false }
  const widthValue = dimensionInput(workflow, widthTarget).value
  const heightValue = dimensionInput(workflow, heightTarget).value
  return {
    width: numericDimension(widthValue),
    height: numericDimension(heightValue),
    configured: hasConfiguredDimension(widthValue) && hasConfiguredDimension(heightValue),
  }
}

function applyDefaultDimensions(workflow: JsonRecord, settings: ComfyUISettings): void {
  const widthTarget = dimensionTarget(workflow, settings.inputMapping, 'width')
  const heightTarget = dimensionTarget(workflow, settings.inputMapping, 'height')
  if (!widthTarget || !heightTarget) {
    const classes = Object.values(workflow).map(nodeClass)
    if (classes.some((value) => /LoadImage/i.test(value)) && classes.some((value) => /VAEEncode/i.test(value))) return
    throw new Error('The ComfyUI workflow has no recognizable width and height inputs')
  }
  const width = dimensionInput(workflow, widthTarget)
  const height = dimensionInput(workflow, heightTarget)
  if (!hasConfiguredDimension(width.value)) width.inputs[width.inputName] = settings.defaultWidth
  if (!hasConfiguredDimension(height.value)) height.inputs[height.inputName] = settings.defaultHeight
}

export function buildComfyUIPrompt(
  settings: ComfyUISettings,
  options: Pick<
    ComfyUIGenerationOptions,
    'prompt' | 'negativePrompt' | 'checkpoint' | 'referenceImage' | 'aspectRatio' | 'count' | 'runtimeParameters'
  >
): JsonRecord {
  const workflow = parseComfyUIWorkflow(settings.workflowJson)
  const mapping = settings.inputMapping
  const target = (kind: keyof typeof mapping) => mapping[kind]?.trim() || autoTarget(workflow, kind)
  applyInput(workflow, target('positivePrompt'), options.prompt, true)
  applyInput(workflow, target('negativePrompt'), options.negativePrompt ?? settings.defaultNegativePrompt ?? '')
  const imageTarget = target('image')
  if (imageTarget && !options.referenceImage)
    throw new Error('The active ComfyUI workflow requires one reference image')
  if (!imageTarget && options.referenceImage)
    throw new Error('The active ComfyUI workflow does not accept a reference image')
  applyInput(workflow, imageTarget, options.referenceImage)
  if (options.checkpoint && options.checkpoint !== COMFYUI_WORKFLOW_MODEL_ID) {
    applyInput(workflow, target('checkpoint'), options.checkpoint)
  }
  applyDefaultDimensions(workflow, settings)
  const runtime = options.runtimeParameters ?? {}
  applyInput(workflow, target('width'), runtime.width)
  applyInput(workflow, target('height'), runtime.height)
  applyInput(workflow, target('steps'), runtime.steps)
  applyInput(workflow, target('cfg'), runtime.cfg)
  applyInput(workflow, target('sampler'), runtime.sampler)
  applyInput(workflow, target('scheduler'), runtime.scheduler)
  applyInput(workflow, target('denoise'), runtime.denoise)
  applyInput(workflow, target('loraStrengthModel'), runtime.loraStrength)
  applyInput(workflow, target('loraStrengthClip'), runtime.loraStrength)
  applyInput(workflow, target('controlNetStrength'), runtime.controlNetStrength)
  applyInput(workflow, target('controlNetStart'), runtime.controlNetStart)
  applyInput(workflow, target('controlNetEnd'), runtime.controlNetEnd)
  const seed =
    runtime.seed !== undefined && runtime.seed >= 0 ? runtime.seed : Math.floor(Math.random() * 1_000_000_000_000_000)
  applyInput(workflow, target('seed'), seed)
  applyInput(workflow, target('batchSize'), Math.max(1, Math.min(options.count ?? 1, 4)))
  return workflow
}

function dataUrlToBlob(dataUrl: string): Blob {
  const separator = dataUrl.indexOf(',')
  if (separator < 0) throw new Error('The reference image data is invalid')
  const header = dataUrl.slice(0, separator)
  const mimeType = /^data:([^;,]+)/.exec(header)?.[1] ?? 'image/png'
  const payload = dataUrl.slice(separator + 1)
  const bytes = header.includes(';base64')
    ? Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload))
  return new Blob([bytes], { type: mimeType })
}

export async function uploadComfyUIImage(
  settings: ComfyUISettings,
  imageData: string,
  signal?: AbortSignal
): Promise<string> {
  const blob = dataUrlToBlob(imageData)
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
  const filename = `chatbox-${globalThis.crypto?.randomUUID?.() ?? Date.now()}.${extension}`
  const url = `${normalizeComfyUIEndpoint(settings.endpoint)}/upload/image`
  if (platform.type === 'mobile') {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    }
    const boundary = `ChatboxBoundary${Date.now().toString(36)}`
    const response = await abortable(
      CapacitorHttp.request({
        url,
        method: 'POST',
        headers: { ...buildComfyUIHeaders(settings), 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        dataType: 'formData',
        data: [
          { key: 'image', value: btoa(binary), type: 'base64File', contentType: blob.type, fileName: filename },
          { key: 'overwrite', value: 'true', type: 'string' },
          { key: 'type', value: 'input', type: 'string' },
        ],
        responseType: 'json',
        connectTimeout: 15_000,
        readTimeout: Math.min(settings.timeoutSeconds * 1000, 120_000),
      }),
      signal
    )
    if (response.status < 200 || response.status >= 300) {
      throw new ComfyUIRequestError(`ComfyUI returned HTTP ${response.status}`, response.status, response.data)
    }
    const result = asRecord(response.data)
    if (typeof result?.name !== 'string' || !result.name) throw new Error('ComfyUI returned no uploaded image name')
    const subfolder = typeof result.subfolder === 'string' ? result.subfolder.replace(/^\/+|\/+$/g, '') : ''
    return subfolder ? `${subfolder}/${result.name}` : result.name
  }
  const form = new FormData()
  form.append('image', blob, filename)
  form.append('overwrite', 'true')
  form.append('type', 'input')
  const response = await fetch(url, {
    method: 'POST',
    headers: buildComfyUIHeaders(settings),
    body: form,
    signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined)
    throw new ComfyUIRequestError(`ComfyUI returned HTTP ${response.status}`, response.status, payload)
  }
  const result = asRecord(await response.json())
  if (typeof result?.name !== 'string' || !result.name) throw new Error('ComfyUI returned no uploaded image name')
  const subfolder = typeof result.subfolder === 'string' ? result.subfolder.replace(/^\/+|\/+$/g, '') : ''
  return subfolder ? `${subfolder}/${result.name}` : result.name
}

function historyImages(payload: unknown, promptId: string, outputNodeId?: string): ComfyUIImageDescriptor[] | null {
  const root = asRecord(payload)
  const history = asRecord(root?.[promptId]) ?? (root && 'outputs' in root ? root : undefined)
  if (!history) return null
  const status = asRecord(history.status)
  if (status?.status_str === 'error') throw new Error('ComfyUI reported a workflow execution error')
  const outputs = asRecord(history.outputs)
  if (!outputs) return []
  const selectedOutputs = outputNodeId ? [[outputNodeId, outputs[outputNodeId]] as const] : Object.entries(outputs)
  const images: ComfyUIImageDescriptor[] = []
  for (const [, output] of selectedOutputs) {
    const candidates = asRecord(output)?.images
    if (!Array.isArray(candidates)) continue
    for (const candidate of candidates) {
      const image = asRecord(candidate)
      if (typeof image?.filename !== 'string') continue
      images.push({
        filename: image.filename,
        subfolder: typeof image.subfolder === 'string' ? image.subfolder : undefined,
        type: typeof image.type === 'string' ? image.type : undefined,
      })
    }
  }
  return images
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read the ComfyUI image'))
    reader.readAsDataURL(blob)
  })
}

async function downloadImage(
  settings: ComfyUISettings,
  descriptor: ComfyUIImageDescriptor,
  signal?: AbortSignal
): Promise<string> {
  const query = new URLSearchParams({ filename: descriptor.filename })
  if (descriptor.subfolder) query.set('subfolder', descriptor.subfolder)
  if (descriptor.type) query.set('type', descriptor.type)
  const url = `${normalizeComfyUIEndpoint(settings.endpoint)}/view?${query}`
  const requestHeaders = buildComfyUIHeaders(settings)

  if (platform.type === 'mobile') {
    const response = await abortable(
      CapacitorHttp.request({ url, method: 'GET', headers: requestHeaders, responseType: 'blob' }),
      signal
    )
    if (response.status < 200 || response.status >= 300) {
      throw new ComfyUIRequestError(`ComfyUI returned HTTP ${response.status}`, response.status, response.data)
    }
    if (typeof response.data !== 'string') throw new Error('ComfyUI returned an invalid image')
    return response.data.startsWith('data:') ? response.data : `data:image/png;base64,${response.data}`
  }

  const response = await fetch(url, { headers: requestHeaders, signal })
  if (!response.ok) {
    throw new ComfyUIRequestError(`ComfyUI returned HTTP ${response.status}`, response.status)
  }
  return blobToDataUrl(await response.blob())
}

function isRetriableComfyUIRequest(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false
  if (error instanceof ComfyUIRequestError) {
    return (
      error.status === 0 || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500
    )
  }
  // Native HTTP rejects with a plain Error when Android temporarily suspends
  // or changes the active network while the screen is off.
  return error instanceof Error
}

async function downloadImageWithRetry(
  settings: ComfyUISettings,
  descriptor: ComfyUIImageDescriptor,
  signal?: AbortSignal
): Promise<string> {
  const retryDelays = [500, 1_000, 2_000, 4_000]
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await downloadImage(settings, descriptor, signal)
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      const delay = retryDelays[attempt]
      if (delay === undefined || !isRetriableComfyUIRequest(error)) throw error
      await abortable(new Promise((resolve) => setTimeout(resolve, delay)), signal)
    }
  }
}

export async function generateWithComfyUI(
  settings: ComfyUISettings,
  options: ComfyUIGenerationOptions
): Promise<{ promptId: string; images: string[]; parameters: ComfyUIRuntimeParameters }> {
  if (!settings.enabled) throw new Error('ComfyUI is disabled')
  const clientId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  options.onProgress?.({ stage: 'preparing', percent: 0 })
  const uploadedImage = options.referenceImage
    ? await (async () => {
        options.onProgress?.({ stage: 'uploading', percent: 5 })
        return uploadComfyUIImage(settings, options.referenceImage!, options.signal)
      })()
    : undefined
  const parameters: ComfyUIRuntimeParameters = {
    ...options.runtimeParameters,
    seed:
      options.runtimeParameters?.seed !== undefined && options.runtimeParameters.seed >= 0
        ? Math.floor(options.runtimeParameters.seed)
        : Math.floor(Math.random() * 1_000_000_000_000_000),
  }
  const workflow = buildComfyUIPrompt(settings, {
    ...options,
    runtimeParameters: parameters,
    referenceImage: uploadedImage,
  })
  const submission = asRecord(
    await requestComfyUIJson(settings, '/prompt', {
      method: 'POST',
      body: { prompt: workflow, client_id: clientId },
      signal: options.signal,
    })
  )
  const promptId = typeof submission?.prompt_id === 'string' ? submission.prompt_id : undefined
  if (!promptId) {
    const detail = asRecord(submission?.node_errors)
    throw new Error(
      detail ? `ComfyUI rejected the workflow: ${JSON.stringify(detail)}` : 'ComfyUI returned no prompt id'
    )
  }
  options.onSubmitted?.(promptId)
  options.onProgress?.({ stage: 'queued', percent: 10 })

  const images = await waitForComfyUIImages(settings, promptId, options.signal, options.onProgress)
  options.onProgress?.({ stage: 'completed', percent: 100 })
  return { promptId, images, parameters }
}

export async function waitForComfyUIImages(
  settings: ComfyUISettings,
  promptId: string,
  signal?: AbortSignal,
  onProgress?: ComfyUIGenerationOptions['onProgress']
): Promise<string[]> {
  const deadline = Date.now() + settings.timeoutSeconds * 1000
  let descriptors: ComfyUIImageDescriptor[] | null = null
  // Poll once before checking the deadline on every iteration. If the WebView
  // was suspended despite Android background protection, the first turn after
  // resume can still collect a result completed while the screen was off.
  while (descriptors === null) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    let historyPayload: unknown
    try {
      historyPayload = await requestComfyUIJson(settings, `/history/${encodeURIComponent(promptId)}`, { signal })
    } catch (error) {
      if (!isRetriableComfyUIRequest(error)) throw error
    }
    if (historyPayload !== undefined) {
      descriptors = historyImages(historyPayload, promptId, settings.outputNodeId?.trim() || undefined)
    }
    if (descriptors === null) {
      if (Date.now() >= deadline) break
      const queue = asRecord(await requestComfyUIJson(settings, '/queue', { signal }).catch(() => undefined))
      const running = Array.isArray(queue?.queue_running) ? queue.queue_running : []
      const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending : []
      if (running.some((entry) => Array.isArray(entry) && entry.some((value) => value === promptId))) {
        onProgress?.({ stage: 'running', percent: 35 })
      } else {
        const pendingIndex = pending.findIndex(
          (entry) => Array.isArray(entry) && entry.some((value) => value === promptId)
        )
        onProgress?.({
          stage: 'queued',
          percent: 10,
          ...(pendingIndex >= 0 ? { queuePosition: pendingIndex + 1 } : {}),
        })
      }
      await abortable(new Promise((resolve) => setTimeout(resolve, settings.pollIntervalMs)), signal)
    }
  }
  if (descriptors === null) throw new Error(`ComfyUI timed out after ${settings.timeoutSeconds} seconds`)
  if (descriptors.length === 0) throw new Error('ComfyUI completed without returning an image')
  onProgress?.({ stage: 'downloading', percent: 90 })
  return Promise.all(descriptors.map((image) => downloadImageWithRetry(settings, image, signal)))
}

export async function cancelComfyUIJob(
  settings: ComfyUISettings,
  promptId: string,
  signal?: AbortSignal
): Promise<void> {
  const queue = asRecord(await requestComfyUIJson(settings, '/queue', { signal }).catch(() => undefined))
  const running = Array.isArray(queue?.queue_running) ? queue.queue_running : []
  const isRunning = running.some((entry) => Array.isArray(entry) && entry.some((value) => value === promptId))
  await requestComfyUIJson(settings, '/queue', { method: 'POST', body: { delete: [promptId] }, signal }).catch(
    () => undefined
  )
  // /interrupt is global to a ComfyUI instance. Only use it when this exact
  // prompt is running, so cancelling a queued Chatbox job cannot stop another client.
  if (isRunning) {
    await requestComfyUIJson(settings, '/interrupt', { method: 'POST', body: {}, signal }).catch(() => undefined)
  }
}
