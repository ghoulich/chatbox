import type { ImageModelGroup } from '@/hooks/useImageModelGroups'

export interface ImageModelSelection {
  provider: string
  model: string
}

export function resolveImageModelSelection(
  modelGroups: ImageModelGroup[],
  selectedProvider: string,
  selectedModel: string,
  fallbacks: ImageModelSelection[] = []
): ImageModelSelection | null {
  for (const selection of [{ provider: selectedProvider, model: selectedModel }, ...fallbacks]) {
    const group = modelGroups.find((candidate) => candidate.providerId === selection.provider)
    if (group?.models.some((model) => model.modelId === selection.model)) return selection
  }

  const firstGroup = modelGroups.find((group) => group.models.length > 0)
  const firstModel = firstGroup?.models[0]
  return firstGroup && firstModel ? { provider: firstGroup.providerId, model: firstModel.modelId } : null
}
