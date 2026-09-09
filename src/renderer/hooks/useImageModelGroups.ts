import { ModelProviderEnum, ModelProviderType } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  type ImageModelOption,
  isOpenAIImageGenerationAuthSupported,
  loadProviderImageModels,
  manualImageModelToOption,
  mergeImageModels,
} from '@/packages/image-model-catalog'
import { loadComfyUICheckpoints } from '@/packages/comfyui/client'
import { COMFYUI_IMAGE_PROVIDER_ID, COMFYUI_WORKFLOW_MODEL_ID } from '@/packages/comfyui/constants'
import { useLanguage, useSettingsStore } from '@/stores/settingsStore'
import useChatboxAIModels from './useChatboxAIModels'
import { useProviders } from './useProviders'

export interface ImageModelGroup {
  label: string
  providerId: string
  isCustom?: boolean
  models: ImageModelOption[]
}

function credentialCacheKey(value: string | undefined): string {
  let hash = 2166136261
  for (const character of value ?? '') {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `${value?.length ?? 0}:${(hash >>> 0).toString(36)}`
}

export function useProviderImageModels(provider: ModelProviderEnum, enabled: boolean): ImageModelOption[] {
  const language = useLanguage()
  const licenseKey = useSettingsStore((state) => state.licenseKey)

  const { data } = useQuery({
    queryKey: [
      'provider-image-models',
      provider,
      language,
      provider === ModelProviderEnum.ChatboxAI ? licenseKey || '' : '',
    ],
    enabled,
    staleTime: 3600 * 1000,
    queryFn: () =>
      loadProviderImageModels(provider, {
        language,
        licenseKey,
      }),
  })

  return data || []
}

export function useImageModelGroups(): ImageModelGroup[] {
  const { providers } = useProviders()
  const { chatboxAIImageModels } = useChatboxAIModels()
  const providerSettingsMap = useSettingsStore((state) => state.providers)
  const comfyui = useSettingsStore((state) => state.comfyui)

  const chatboxProvider = providers.find((p) => p.id === ModelProviderEnum.ChatboxAI)
  const openAIProvider = providers.find((p) => p.id === ModelProviderEnum.OpenAI)
  const geminiProvider = providers.find((p) => p.id === ModelProviderEnum.Gemini)
  const customGeminiProviders = providers.filter((p) => p.isCustom && p.type === ModelProviderType.Gemini)

  const openAIImageModels = useProviderImageModels(ModelProviderEnum.OpenAI, !!openAIProvider)
  const geminiImageModels = useProviderImageModels(
    ModelProviderEnum.Gemini,
    !!geminiProvider || customGeminiProviders.length > 0
  )
  const { data: comfyUICheckpoints = [] } = useQuery({
    queryKey: ['comfyui-checkpoints', comfyui.endpoint, comfyui.username || '', credentialCacheKey(comfyui.password)],
    enabled: comfyui.enabled && !!comfyui.endpoint.trim(),
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () => loadComfyUICheckpoints(comfyui),
  })

  return useMemo(() => {
    const groups: ImageModelGroup[] = []
    if (chatboxProvider) {
      const excluded = new Set(providerSettingsMap?.[ModelProviderEnum.ChatboxAI]?.excludedModels || [])
      const models = chatboxAIImageModels.map(manualImageModelToOption).filter((model) => !excluded.has(model.modelId))
      if (models.length > 0) {
        groups.push({
          label: chatboxProvider.name,
          providerId: chatboxProvider.id,
          models,
        })
      }
    }

    if (geminiProvider) {
      const manualModels = (providerSettingsMap?.[geminiProvider.id]?.models || [])
        .filter((model) => model.type === 'image')
        .map(manualImageModelToOption)
      const models = mergeImageModels(geminiImageModels, manualModels)
      if (models.length > 0) {
        groups.push({
          label: geminiProvider.name,
          providerId: geminiProvider.id,
          models,
        })
      }
    }

    for (const provider of customGeminiProviders) {
      const manualModels = (providerSettingsMap?.[provider.id]?.models || [])
        .filter((model) => model.type === 'image')
        .map(manualImageModelToOption)
      const models = mergeImageModels(geminiImageModels, manualModels)
      if (models.length > 0) {
        groups.push({
          label: provider.name,
          providerId: provider.id,
          isCustom: true,
          models,
        })
      }
    }

    if (openAIProvider && isOpenAIImageGenerationAuthSupported(providerSettingsMap)) {
      const manualModels = (providerSettingsMap?.[openAIProvider.id]?.models || [])
        .filter((model) => model.type === 'image')
        .map(manualImageModelToOption)
      const models = mergeImageModels(openAIImageModels, manualModels)
      if (models.length > 0) {
        groups.push({
          label: openAIProvider.name,
          providerId: openAIProvider.id,
          models,
        })
      }
    }

    if (comfyui.enabled && comfyui.endpoint.trim() && comfyui.workflowJson.trim()) {
      groups.push({
        label: 'ComfyUI',
        providerId: COMFYUI_IMAGE_PROVIDER_ID,
        isCustom: true,
        models:
          comfyUICheckpoints.length > 0
            ? comfyUICheckpoints.map((modelId) => ({ modelId, displayName: modelId }))
            : [
                {
                  modelId: COMFYUI_WORKFLOW_MODEL_ID,
                  displayName: comfyui.workflowName.trim() || 'ComfyUI Workflow',
                },
              ],
      })
    }

    return groups
  }, [
    chatboxProvider,
    openAIProvider,
    geminiProvider,
    customGeminiProviders,
    providerSettingsMap,
    chatboxAIImageModels,
    openAIImageModels,
    geminiImageModels,
    comfyui,
    comfyUICheckpoints,
  ])
}
