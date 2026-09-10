import { describe, expect, it } from 'vitest'
import { ImageGenerationSchema } from './image-generation'

describe('ImageGenerationSchema ComfyUI reproducibility metadata', () => {
  it('preserves workflow parameters, reference processing, and queue progress', () => {
    const parsed = ImageGenerationSchema.parse({
      id: 'record-1',
      prompt: 'a city at night',
      referenceImages: ['picture:reference'],
      generatedImages: [],
      createdAt: 1,
      model: { provider: 'comfyui', modelId: 'sd15.safetensors' },
      status: 'generating',
      comfyuiMetadata: {
        workflowId: 'workflow-1',
        workflowName: 'SD 1.5 img2img',
        workflowRevision: 4,
        parameters: { steps: 24, cfg: 6.5, seed: 123, denoise: 0.65 },
        referenceProcessing: {
          originalBytes: 5_000_000,
          processedBytes: 600_000,
          originalWidth: 4000,
          originalHeight: 3000,
          width: 2048,
          height: 1536,
          mimeType: 'image/webp',
          resized: true,
        },
      },
      progress: { stage: 'queued', percent: 10, queuePosition: 2, updatedAt: 2 },
    })

    expect(parsed.comfyuiMetadata?.parameters.seed).toBe(123)
    expect(parsed.comfyuiMetadata?.referenceProcessing?.resized).toBe(true)
    expect(parsed.progress).toMatchObject({ stage: 'queued', queuePosition: 2 })
  })
})
