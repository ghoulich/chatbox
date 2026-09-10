import { BaseError } from '@shared/models/errors'
import { getModel } from '@shared/providers'
import type {
  ComfyUIGenerationMetadata,
  ComfyUIReferenceProcessing,
  ComfyUIRuntimeParameters,
  ImageGeneration,
  ImageGenerationModel,
  ImageGenerationProgress,
  ImageGenerationSource,
} from '@shared/types'
import { ModelProviderEnum } from '@shared/types'
import { createModelDependencies } from '@/adapters'
import { normalizePlausibleModel, normalizePlausibleProvider } from '@/analytics/plausible'
import i18n from '@/i18n'
import { getLogger } from '@/lib/utils'
import {
  IMAGE_GENERATION_POLL_INTERVAL_MS,
  type ImageGenerationTaskResponse,
  pollImageTask,
  pollTaskUntilComplete,
  submitImageGeneration,
} from '@/packages/remote'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { COMFYUI_IMAGE_PROVIDER_ID, COMFYUI_WORKFLOW_MODEL_ID } from '@/packages/comfyui/constants'
import { activateWorkflow, getComfyUIRuntimeDefaults } from '@/packages/comfyui/workflows'
import { trackEvent } from '@/utils/track'
import {
  addGeneratedImage,
  createRecord,
  IMAGE_GEN_LIST_QUERY_KEY,
  IMAGE_GEN_QUERY_KEY,
  imageGenerationStore,
  updateRecord,
} from './imageGenerationStore'
import { queryClient } from './queryClient'
import { settingsStore } from './settingsStore'
import { lastUsedModelStore } from './lastUsedModelStore'

const log = getLogger('image-generation-actions')

// AbortController for cancelling in-flight polling
let currentAbortController: AbortController | null = null
let currentComfyUIJob: { promptId: string; recordId: string } | null = null
let currentComfyUIRecordId: string | null = null
const cancelledComfyUIRecordIds = new Set<string>()

function getLicenseKey(): string {
  const licenseKey = settingsStore.getState().licenseKey
  if (!licenseKey) {
    throw new Error('License key is required for image generation')
  }
  return licenseKey
}

function shouldUseAsyncPath(provider: string): boolean {
  return provider === ModelProviderEnum.ChatboxAI
}

function getErrorRecordUpdate(
  error: unknown
): Pick<ImageGeneration, 'status' | 'error' | 'errorCode' | 'errorItemUuid'> {
  const normalizedError = error instanceof Error ? error : new Error(`${error}`)
  return {
    status: 'error',
    error: normalizedError.message,
    errorCode: error instanceof BaseError ? error.code : undefined,
    errorItemUuid: undefined,
  }
}

function getFailedImageGenerationError(
  result: ImageGenerationTaskResponse,
  fallback: string
): Pick<ImageGeneration, 'error' | 'errorCode' | 'errorItemUuid'> {
  const failedItem = result.items.find((item) => item.status === 'failed')
  return {
    error: failedItem?.error_message || fallback,
    errorCode: failedItem?.error_code,
    errorItemUuid: failedItem?.uuid,
  }
}

function getCompletedImages(result: ImageGenerationTaskResponse): {
  imageUrls: string[]
  thumbnailUrls: string[]
} {
  const completedItems = result.items.filter(
    (item): item is typeof item & { image_url: string } => item.status === 'completed' && !!item.image_url
  )

  return {
    imageUrls: completedItems.map((item) => item.image_url),
    thumbnailUrls: completedItems.map((item) => item.thumbnail_url || item.image_url),
  }
}

export interface GenerateImageParams {
  prompt: string
  referenceImages: string[]
  model: ImageGenerationModel
  dalleStyle?: 'vivid' | 'natural'
  imageGenerateNum?: number
  aspectRatio?: string
  parentIds?: string[]
  source?: ImageGenerationSource
  comfyui?: {
    workflowId: string
    workflowName: string
    workflowRevision?: number
    parameters: ComfyUIRuntimeParameters
    referenceProcessing?: ComfyUIReferenceProcessing
  }
}

function progressUpdate(progress: Omit<ImageGenerationProgress, 'updatedAt'>): Pick<ImageGeneration, 'progress'> {
  return { progress: { ...progress, updatedAt: Date.now() } }
}

async function markComfyUIGenerationCancelled(recordId: string): Promise<ImageGeneration | null> {
  const updated = await updateRecord(recordId, {
    status: 'error',
    error: i18n.t('Generation cancelled') ?? 'Generation cancelled',
    ...progressUpdate({ stage: 'cancelled', percent: 0 }),
  })
  if (updated) queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], updated)
  return updated
}

function getComfyUIMetadata(params: GenerateImageParams): ComfyUIGenerationMetadata | undefined {
  if (params.model.provider !== COMFYUI_IMAGE_PROVIDER_ID) return undefined
  if (params.comfyui) return { ...params.comfyui }
  const comfyui = settingsStore.getState().comfyui
  const profile = comfyui.workflowProfiles.find((item) => item.id === comfyui.activeWorkflowId)
  if (!profile) return undefined
  return {
    workflowId: profile.id,
    workflowName: profile.name,
    workflowRevision: profile.remote?.revision,
    parameters: getComfyUIRuntimeDefaults(profile),
  }
}

export function isGenerating(): boolean {
  return imageGenerationStore.getState().currentGeneratingId !== null
}

export interface ImageGenerationHandle {
  recordId: string
  startedAt: number
  monitoring: { mode: 'polling'; intervalMs: number } | { mode: 'direct' }
  completion: Promise<ImageGeneration | null>
}

export interface StartImageGenerationOptions {
  /**
   * Runs after the local record is durable and before any potentially billable
   * provider request starts. Callers can use this to persist their own retry key.
   */
  onRecordCreated?: (record: ImageGeneration) => Promise<void>
}

/**
 * Starts image generation without waiting for the provider task to finish.
 * Callers that need background-task notifications can observe `completion`;
 * existing UI callers can keep using `createAndGenerate` and only consume the id.
 */
export async function startImageGeneration(
  params: GenerateImageParams,
  options: StartImageGenerationOptions = {}
): Promise<ImageGenerationHandle> {
  const store = imageGenerationStore.getState()

  // Normalize: 'auto' means no aspect ratio constraint
  if (params.aspectRatio === 'auto') {
    params = { ...params, aspectRatio: undefined }
  }

  if (store.currentGeneratingId !== null) {
    throw new Error('Another image is being generated. Please wait.')
  }

  const comfyuiMetadata = getComfyUIMetadata(params)
  const record = await createRecord({
    prompt: params.prompt,
    referenceImages: params.referenceImages,
    model: params.model,
    dalleStyle: params.dalleStyle,
    imageGenerateNum: params.imageGenerateNum,
    parentIds: params.parentIds,
    aspectRatio: params.aspectRatio,
    source: params.source,
    comfyuiMetadata,
    ...(comfyuiMetadata ? progressUpdate({ stage: 'preparing', percent: 0 }) : {}),
  })

  try {
    await options.onRecordCreated?.(record)
  } catch (error) {
    await updateRecord(record.id, getErrorRecordUpdate(error))
    throw error
  }

  store.setCurrentGeneratingId(record.id)
  store.setCurrentRecordId(record.id)
  lastUsedModelStore.getState().setPictureModel(params.model.provider, params.model.modelId)
  queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, record.id], record)

  const generateFn =
    params.model.provider === COMFYUI_IMAGE_PROVIDER_ID
      ? generateImagesWithComfyUI
      : shouldUseAsyncPath(params.model.provider)
        ? generateImages
        : generateImagesDirect
  const generation = generateFn(record.id, params).finally(() => {
    imageGenerationStore.getState().setCurrentGeneratingId(null)
    queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
  })

  return {
    recordId: record.id,
    startedAt: record.createdAt,
    monitoring: shouldUseAsyncPath(params.model.provider)
      ? { mode: 'polling', intervalMs: IMAGE_GENERATION_POLL_INTERVAL_MS }
      : { mode: 'direct' },
    completion: generation,
  }
}

async function generateImagesWithComfyUI(
  recordId: string,
  params: GenerateImageParams
): Promise<ImageGeneration | null> {
  const num = params.imageGenerateNum || 1
  currentAbortController = new AbortController()
  currentComfyUIRecordId = recordId
  const signal = currentAbortController.signal

  try {
    const storedComfyUI = settingsStore.getState().comfyui
    const workflowId = params.comfyui?.workflowId
    const activeProfile = storedComfyUI.workflowProfiles.find((profile) =>
      workflowId ? profile.id === workflowId : profile.id === storedComfyUI.activeWorkflowId
    )
    if (!activeProfile)
      throw new Error(
        i18n.t('The saved ComfyUI workflow is no longer available.') ??
          'The saved ComfyUI workflow is no longer available.'
      )
    const comfyui = activateWorkflow(storedComfyUI, activeProfile.id)
    if (params.referenceImages.length > 1)
      throw new Error(
        i18n.t('ComfyUI workflows currently accept only one reference image.') ??
          'ComfyUI workflows currently accept only one reference image.'
      )
    if (params.referenceImages.length > 0 && !activeProfile?.capabilities.imageToImage) {
      throw new Error(
        i18n.t('The active ComfyUI workflow does not accept a reference image.') ??
          'The active ComfyUI workflow does not accept a reference image.'
      )
    }
    if (params.referenceImages.length === 0 && activeProfile?.capabilities.imageToImage) {
      throw new Error(
        i18n.t('The active ComfyUI workflow requires one reference image.') ??
          'The active ComfyUI workflow requires one reference image.'
      )
    }
    const { generateWithComfyUI, validateComfyUIModels } = await import('@/packages/comfyui/client')
    const missingModels = await validateComfyUIModels(
      comfyui,
      {
        checkpoint:
          params.model.modelId === COMFYUI_WORKFLOW_MODEL_ID ? activeProfile.builder?.checkpoint : params.model.modelId,
        lora: activeProfile.builder?.loraName,
        controlNet: activeProfile.builder?.controlNetName,
      },
      signal
    )
    if (missingModels.length > 0) {
      throw new Error(
        i18n.t('Missing ComfyUI model: {{name}}', { name: missingModels.join(', ') }) ??
          `Missing ComfyUI model: ${missingModels.join(', ')}`
      )
    }
    let referenceImage: string | undefined
    const reference = params.referenceImages[0]
    if (reference) {
      referenceImage =
        reference.startsWith('http://') || reference.startsWith('https://')
          ? await fetch(reference, { signal }).then(async (response) => {
              if (!response.ok) throw new Error(`Unable to load reference image: HTTP ${response.status}`)
              const blob = await response.blob()
              return new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(String(reader.result))
                reader.onerror = () => reject(reader.error ?? new Error('Unable to read reference image'))
                reader.readAsDataURL(blob)
              })
            })
          : await (await createModelDependencies()).storage.getImage(reference)
      if (!referenceImage) throw new Error('Unable to load the reference image')
    }
    let currentRecord = await updateRecord(recordId, { status: 'generating' })
    if (currentRecord) queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)

    trackEvent('generate_image', {
      provider: COMFYUI_IMAGE_PROVIDER_ID,
      model: params.model.modelId,
      num_images: num,
      has_reference: Boolean(referenceImage),
      path: 'comfyui',
    })
    let pendingRecordUpdate = Promise.resolve()
    const queueRecordUpdate = (updates: Partial<ImageGeneration>) => {
      pendingRecordUpdate = pendingRecordUpdate.then(async () => {
        if (cancelledComfyUIRecordIds.has(recordId)) return
        const updated = await updateRecord(recordId, updates)
        if (updated) queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], updated)
      })
    }
    const result = await generateWithComfyUI(comfyui, {
      prompt: params.prompt,
      checkpoint: params.model.modelId,
      referenceImage,
      aspectRatio: params.aspectRatio,
      count: num,
      signal,
      runtimeParameters: params.comfyui?.parameters ?? getComfyUIRuntimeDefaults(activeProfile),
      onSubmitted: (promptId) => {
        currentComfyUIJob = { promptId, recordId }
        queueRecordUpdate({
          taskId: promptId,
          comfyuiMetadata: {
            ...(params.comfyui ?? {
              workflowId: activeProfile.id,
              workflowName: activeProfile.name,
              workflowRevision: activeProfile.remote?.revision,
              parameters: getComfyUIRuntimeDefaults(activeProfile),
            }),
            submittedAt: Date.now(),
          },
        })
      },
      onProgress: (progress) => {
        queueRecordUpdate(progressUpdate(progress))
      },
    })
    await pendingRecordUpdate

    if (cancelledComfyUIRecordIds.has(recordId)) {
      return await markComfyUIGenerationCancelled(recordId)
    }

    for (const image of result.images) {
      const storageKey = StorageKeyGenerator.picture(`image-gen:${recordId}`)
      await storage.setBlob(storageKey, image)
      currentRecord = await addGeneratedImage(recordId, storageKey)
      if (currentRecord) queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
    }
    currentRecord = await updateRecord(recordId, {
      status: result.images.length < num ? 'error' : 'done',
      error: result.images.length < num ? 'ComfyUI returned fewer images than requested' : undefined,
      comfyuiMetadata: {
        ...(params.comfyui ??
          currentRecord?.comfyuiMetadata ?? {
            workflowId: activeProfile.id,
            workflowName: activeProfile.name,
            workflowRevision: activeProfile.remote?.revision,
          }),
        parameters: result.parameters,
        completedAt: Date.now(),
      },
      ...progressUpdate({ stage: 'completed', percent: 100 }),
    })
    if (currentRecord) queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
    return currentRecord
  } catch (err: unknown) {
    if (cancelledComfyUIRecordIds.has(recordId)) {
      log.debug('ComfyUI image generation cancelled:', recordId)
      return await markComfyUIGenerationCancelled(recordId)
    }
    if (err instanceof Error && err.name === 'AbortError') {
      log.debug('ComfyUI image generation aborted:', recordId)
      return null
    }
    log.error('ComfyUI image generation failed:', err)
    const updatedRecord = await updateRecord(recordId, getErrorRecordUpdate(err))
    if (updatedRecord) queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, updatedRecord.id], updatedRecord)
    return updatedRecord
  } finally {
    currentAbortController = null
    currentComfyUIJob = null
    currentComfyUIRecordId = null
    cancelledComfyUIRecordIds.delete(recordId)
  }
}

export async function createAndGenerate(params: GenerateImageParams): Promise<string> {
  const handle = await startImageGeneration(params)
  return handle.recordId
}

async function generateImages(recordId: string, params: GenerateImageParams): Promise<ImageGeneration | null> {
  const licenseKey = getLicenseKey()
  const num = params.imageGenerateNum || 1

  // Create AbortController for this generation
  currentAbortController = new AbortController()
  const signal = currentAbortController.signal

  try {
    // Update status to generating
    let currentRecord = await updateRecord(recordId, { status: 'generating' })
    if (currentRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
    }

    // Prepare reference images - convert storage keys to base64 data URLs if needed
    const dependencies = await createModelDependencies()
    const referenceImageData: Array<{ image_url: string }> = []

    for (const keyOrUrl of params.referenceImages) {
      if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
        referenceImageData.push({ image_url: keyOrUrl })
      } else {
        const imageData = await dependencies.storage.getImage(keyOrUrl)
        if (imageData) {
          log.debug('Reference image from storage key:', keyOrUrl, 'data length:', imageData.length)
          referenceImageData.push({ image_url: imageData })
        }
      }
    }

    trackEvent('generate_image', {
      provider: normalizePlausibleProvider(params.model.provider),
      model: normalizePlausibleModel(params.model.provider, params.model.modelId),
      num_images: num,
      has_reference: params.referenceImages.length > 0,
    })

    // Single submit with quantity
    const submission = await submitImageGeneration(
      {
        model: params.model.modelId,
        prompt: params.prompt,
        response_format: 'b64_json',
        style: params.dalleStyle || 'vivid',
        aspect_ratio: params.aspectRatio,
        quantity: num,
        images: referenceImageData.length > 0 ? referenceImageData : undefined,
      },
      licenseKey
    )

    log.debug('Submitted image generation task:', submission.task_id, 'items:', submission.items.length)

    // Store task ID for resume capability
    currentRecord = await updateRecord(recordId, { taskId: submission.task_id })
    if (currentRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
    }

    // Poll until all items are finished, progressively updating as images complete
    let lastCompletedCount = 0
    const finalResult = await pollTaskUntilComplete(submission.task_id, licenseKey, {
      signal,
      onPoll: async (response) => {
        const completedImages = getCompletedImages(response)
        if (completedImages.imageUrls.length > lastCompletedCount) {
          lastCompletedCount = completedImages.imageUrls.length
          currentRecord = await updateRecord(recordId, {
            generatedImages: completedImages.imageUrls,
            generatedImageThumbnails: completedImages.thumbnailUrls,
          })
          if (currentRecord) {
            queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
          }
        }
      },
    })

    // Final update: set status based on results
    const completedImages = getCompletedImages(finalResult)
    const completedUrls = completedImages.imageUrls
    const hasError = finalResult.items.some((item) => item.status === 'failed')

    if (completedUrls.length > 0) {
      const failedError = getFailedImageGenerationError(finalResult, 'Some images failed to generate')
      currentRecord = await updateRecord(recordId, {
        generatedImages: completedUrls,
        generatedImageThumbnails: completedImages.thumbnailUrls,
        status: hasError && completedUrls.length < num ? 'error' : 'done',
        error: hasError && completedUrls.length < num ? failedError.error : undefined,
        errorCode: hasError && completedUrls.length < num ? failedError.errorCode : undefined,
        errorItemUuid: hasError && completedUrls.length < num ? failedError.errorItemUuid : undefined,
      })
    } else {
      currentRecord = await updateRecord(recordId, {
        status: 'error',
        ...getFailedImageGenerationError(finalResult, 'All images failed to generate'),
      })
    }

    if (currentRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
    }

    log.debug('Image generation completed:', recordId, 'urls:', completedUrls.length)
    return currentRecord
  } catch (err: unknown) {
    // Don't report abort errors as failures
    if (err instanceof Error && err.name === 'AbortError') {
      log.debug('Image generation aborted:', recordId)
      return null
    }

    log.error('Image generation failed:', err)

    const updatedRecord = await updateRecord(recordId, getErrorRecordUpdate(err))
    if (updatedRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, updatedRecord.id], updatedRecord)
    }
    return updatedRecord
  } finally {
    currentAbortController = null
  }
}

async function generateImagesDirect(recordId: string, params: GenerateImageParams): Promise<ImageGeneration | null> {
  const num = params.imageGenerateNum || 1

  currentAbortController = new AbortController()
  const signal = currentAbortController.signal

  try {
    let currentRecord = await updateRecord(recordId, { status: 'generating' })
    if (currentRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
    }

    // Build model instance via provider registry
    const dependencies = await createModelDependencies()
    const globalSettings = settingsStore.getState().getSettings()
    const configs = await platform.getConfig()
    const sessionSettings = {
      provider: params.model.provider,
      modelId: params.model.modelId,
    }
    const model = getModel(sessionSettings, globalSettings, configs, dependencies)

    // Prepare reference images: storage keys → base64 data URLs
    const images: { imageUrl: string }[] = []
    for (const keyOrUrl of params.referenceImages) {
      if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
        images.push({ imageUrl: keyOrUrl })
        continue
      }
      const imageData = await dependencies.storage.getImage(keyOrUrl)
      if (imageData) {
        images.push({ imageUrl: imageData })
      }
    }

    trackEvent('generate_image', {
      provider: normalizePlausibleProvider(params.model.provider),
      model: normalizePlausibleModel(params.model.provider, params.model.modelId),
      num_images: num,
      has_reference: params.referenceImages.length > 0,
      path: 'direct',
    })

    // Call model.paint() with progressive callback
    const resultDataUrls = await model.paint(
      {
        prompt: params.prompt,
        images: images.length > 0 ? images : undefined,
        num,
        aspectRatio: params.aspectRatio,
      },
      signal,
      async (picBase64: string) => {
        const storageKey = StorageKeyGenerator.picture(`image-gen:${recordId}`)
        await storage.setBlob(storageKey, picBase64)
        const updated = await addGeneratedImage(recordId, storageKey)
        if (updated) {
          queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], updated)
        }
      }
    )

    // Final status based on how many images we got
    if (resultDataUrls.length > 0) {
      // Ensure all returned images are stored (in case callback wasn't called for some)
      const record = await platform.getImageGenerationStorage().getById(recordId)
      const existingCount = record?.generatedImages.length || 0
      if (existingCount < resultDataUrls.length) {
        for (let i = existingCount; i < resultDataUrls.length; i++) {
          const storageKey = StorageKeyGenerator.picture(`image-gen:${recordId}`)
          await storage.setBlob(storageKey, resultDataUrls[i])
          await addGeneratedImage(recordId, storageKey)
        }
      }

      currentRecord = await updateRecord(recordId, {
        status: resultDataUrls.length < num ? 'error' : 'done',
        error: resultDataUrls.length < num ? 'Some images failed to generate' : undefined,
      })
    } else {
      currentRecord = await updateRecord(recordId, {
        status: 'error',
        error: 'All images failed to generate',
      })
    }

    if (currentRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
    }

    log.debug('Direct image generation completed:', recordId, 'images:', resultDataUrls.length)
    return currentRecord
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      log.debug('Direct image generation aborted:', recordId)
      return null
    }

    log.error('Direct image generation failed:', err)

    const updatedRecord = await updateRecord(recordId, getErrorRecordUpdate(err))
    if (updatedRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, updatedRecord.id], updatedRecord)
    }
    return updatedRecord
  } finally {
    currentAbortController = null
  }
}

export function cancelGeneration(): void {
  const store = imageGenerationStore.getState()
  if (store.currentGeneratingId) {
    // Abort in-flight polling requests
    if (currentAbortController) {
      currentAbortController.abort()
      currentAbortController = null
    }

    const comfyUIRecordId = currentComfyUIJob?.recordId ?? currentComfyUIRecordId
    if (comfyUIRecordId) {
      const job = currentComfyUIJob
      cancelledComfyUIRecordIds.add(comfyUIRecordId)
      currentComfyUIJob = null
      currentComfyUIRecordId = null
      const comfyui = settingsStore.getState().comfyui
      void markComfyUIGenerationCancelled(comfyUIRecordId)
      if (job) {
        void import('@/packages/comfyui/client')
          .then(({ cancelComfyUIJob }) => cancelComfyUIJob(comfyui, job.promptId))
          .catch((error) => log.warn('Unable to cancel the remote ComfyUI job:', error))
      }
    }

    // Clear the active job after the persisted record has been marked as cancelled.
    store.setCurrentGeneratingId(null)
    queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
  }
}

export async function loadRecord(recordId: string): Promise<ImageGeneration | null> {
  const record = await platform.getImageGenerationStorage().getById(recordId)
  if (record) {
    imageGenerationStore.getState().setCurrentRecordId(record.id)
  }
  return record
}

export function clearCurrentRecord(): void {
  imageGenerationStore.getState().setCurrentRecordId(null)
}

export async function resumeGeneration(recordId: string): Promise<ImageGeneration | null> {
  const store = imageGenerationStore.getState()

  if (store.currentGeneratingId !== null) {
    throw new Error('Another image is being generated. Please wait.')
  }

  const record = await platform.getImageGenerationStorage().getById(recordId)
  if (!record) {
    throw new Error('Record not found')
  }

  if (!record.taskId) {
    throw new Error('No task ID found for this record')
  }

  if (record.model.provider === COMFYUI_IMAGE_PROVIDER_ID) {
    store.setCurrentGeneratingId(recordId)
    currentAbortController = new AbortController()
    currentComfyUIRecordId = recordId
    currentComfyUIJob = { promptId: record.taskId, recordId }
    try {
      const { waitForComfyUIImages } = await import('@/packages/comfyui/client')
      const storedComfyUI = settingsStore.getState().comfyui
      const resumableProfile = record.comfyuiMetadata
        ? storedComfyUI.workflowProfiles.find((profile) => profile.id === record.comfyuiMetadata?.workflowId)
        : undefined
      const comfyui = resumableProfile ? activateWorkflow(storedComfyUI, resumableProfile.id) : storedComfyUI
      const images = await waitForComfyUIImages(comfyui, record.taskId, currentAbortController.signal, (progress) => {
        void updateRecord(recordId, progressUpdate(progress)).then((updated) => {
          if (updated) queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], updated)
        })
      })
      for (let index = record.generatedImages.length; index < images.length; index++) {
        const storageKey = StorageKeyGenerator.picture(`image-gen:${recordId}`)
        await storage.setBlob(storageKey, images[index])
        await addGeneratedImage(recordId, storageKey)
      }
      const updated = await updateRecord(recordId, {
        status: images.length < (record.imageGenerateNum || 1) ? 'error' : 'done',
        error:
          images.length < (record.imageGenerateNum || 1) ? 'ComfyUI returned fewer images than requested' : undefined,
        comfyuiMetadata: record.comfyuiMetadata ? { ...record.comfyuiMetadata, completedAt: Date.now() } : undefined,
        ...progressUpdate({ stage: 'completed', percent: 100 }),
      })
      if (updated) queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, updated.id], updated)
      return updated
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return null
      const failed = await updateRecord(recordId, getErrorRecordUpdate(err))
      if (failed) queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, failed.id], failed)
      return failed
    } finally {
      currentAbortController = null
      currentComfyUIJob = null
      currentComfyUIRecordId = null
      store.setCurrentGeneratingId(null)
      queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
    }
  }

  const licenseKey = getLicenseKey()
  store.setCurrentGeneratingId(recordId)

  // Create AbortController for resume operation
  currentAbortController = new AbortController()
  const signal = currentAbortController.signal

  try {
    // Check current status, then poll if not finished
    const currentStatus = await pollImageTask(record.taskId, licenseKey, signal)

    let finalResult = currentStatus
    if (!currentStatus.is_finished) {
      finalResult = await pollTaskUntilComplete(record.taskId, licenseKey, { signal })
    }

    // Collect successful original and thumbnail URLs into the local record.
    const completedImages = getCompletedImages(finalResult)
    const completedUrls = completedImages.imageUrls
    const hasError = finalResult.items.some((item) => item.status === 'failed')

    for (const item of finalResult.items) {
      if (item.status === 'failed') {
        log.error('Image generation item failed on resume:', item.uuid, item.error_message)
      }
    }

    const expectedNum = record.imageGenerateNum || 1

    const updatedRecord = await updateRecord(recordId, {
      generatedImages: completedUrls,
      generatedImageThumbnails: completedImages.thumbnailUrls,
      status: completedUrls.length >= expectedNum ? 'done' : hasError ? 'error' : 'done',
      ...(hasError && completedUrls.length < expectedNum
        ? getFailedImageGenerationError(finalResult, 'Some images failed to generate')
        : { error: undefined, errorCode: undefined, errorItemUuid: undefined }),
    })

    if (updatedRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, updatedRecord.id], updatedRecord)
    }
    return updatedRecord
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      log.debug('Resume generation aborted:', recordId)
      return null
    }

    log.error('Resume generation failed:', err)

    const failedRecord = await updateRecord(recordId, getErrorRecordUpdate(err))
    if (failedRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, failedRecord.id], failedRecord)
    }
    return failedRecord
  } finally {
    currentAbortController = null
    imageGenerationStore.getState().setCurrentGeneratingId(null)
    queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
  }
}

export async function retryGeneration(recordId: string): Promise<void> {
  const store = imageGenerationStore.getState()

  if (store.currentGeneratingId !== null) {
    throw new Error('Another image is being generated. Please wait.')
  }

  const record = await platform.getImageGenerationStorage().getById(recordId)
  if (!record) {
    throw new Error('Record not found')
  }

  // Clear previous task data before retry to avoid confusion
  // This is intentional: retry means start fresh, not resume
  log.debug('Retrying generation, clearing previous task data:', {
    recordId,
    previousTaskId: record.taskId,
  })

  await updateRecord(recordId, {
    taskId: undefined,
    generatedImages: [],
    generatedImageThumbnails: [],
    status: 'pending',
    error: undefined,
    errorCode: undefined,
    errorItemUuid: undefined,
    ...(record.comfyuiMetadata ? progressUpdate({ stage: 'preparing', percent: 0 }) : {}),
  })

  store.setCurrentGeneratingId(recordId)

  const params: GenerateImageParams = {
    prompt: record.prompt,
    referenceImages: record.referenceImages,
    model: record.model,
    dalleStyle: record.dalleStyle,
    imageGenerateNum: record.imageGenerateNum,
    aspectRatio: record.aspectRatio,
    comfyui: record.comfyuiMetadata
      ? {
          workflowId: record.comfyuiMetadata.workflowId,
          workflowName: record.comfyuiMetadata.workflowName,
          workflowRevision: record.comfyuiMetadata.workflowRevision,
          parameters: record.comfyuiMetadata.parameters,
          referenceProcessing: record.comfyuiMetadata.referenceProcessing,
        }
      : undefined,
  }

  const generateFn =
    params.model.provider === COMFYUI_IMAGE_PROVIDER_ID
      ? generateImagesWithComfyUI
      : shouldUseAsyncPath(params.model.provider)
        ? generateImages
        : generateImagesDirect
  void generateFn(recordId, params).finally(() => {
    imageGenerationStore.getState().setCurrentGeneratingId(null)
    queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
  })
}
