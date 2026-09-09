import { describe, expect, it } from 'vitest'
import type { AvailableImageModel } from './image-model-catalog'
import { resolveDefaultImageModel } from './image-model-catalog'

const models: AvailableImageModel[] = [
  { provider: 'openai', modelId: 'gpt-image', nickname: 'GPT Image' },
  { provider: 'comfyui', modelId: 'flux.safetensors', nickname: 'Flux' },
]

describe('resolveDefaultImageModel', () => {
  it('prefers the configured default over last used and catalog order', () => {
    expect(
      resolveDefaultImageModel(
        models,
        { defaultImageModel: { provider: 'comfyui', model: 'flux.safetensors' } },
        { provider: 'openai', modelId: 'gpt-image' }
      )
    ).toEqual(models[1])
  })

  it('falls back to last used, then the first available model', () => {
    expect(
      resolveDefaultImageModel(
        models,
        { defaultImageModel: undefined },
        {
          provider: 'comfyui',
          modelId: 'flux.safetensors',
        }
      )
    ).toEqual(models[1])
    expect(resolveDefaultImageModel(models, { defaultImageModel: undefined })).toEqual(models[0])
  })
})
