import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '@shared/types'
import {
  buildComfyUIHeaders,
  buildComfyUIPrompt,
  inspectComfyUIWorkflowDimensions,
  normalizeComfyUIEndpoint,
  parseComfyUIWorkflow,
  uploadComfyUIImage,
  validateComfyUIModels,
  waitForComfyUIImages,
} from './client'

const settings = {
  enabled: true,
  endpoint: 'http://127.0.0.1:8188',
  workflowName: 'SDXL',
  workflowJson: JSON.stringify({
    3: { class_type: 'KSampler', inputs: { seed: 1, steps: 20 } },
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'old.safetensors' } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: 'old positive' } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: 'old negative' } },
  }),
  inputMapping: {},
  defaultWidth: 1024,
  defaultHeight: 1024,
  timeoutSeconds: 600,
  pollIntervalMs: 1000,
  defaultNegativePrompt: 'blurry',
  workflowProfiles: [],
} satisfies Settings['comfyui']

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('ComfyUI client helpers', () => {
  it('creates Basic authentication headers without exposing credentials in the endpoint', () => {
    expect(buildComfyUIHeaders(settings)).toEqual({ Accept: 'application/json' })
    expect(buildComfyUIHeaders({ ...settings, username: 'artist', password: 'secret' })).toEqual({
      Accept: 'application/json',
      Authorization: 'Basic YXJ0aXN0OnNlY3JldA==',
    })
  })

  it('adds the ComfyUI user header only when a multi-user id is configured', () => {
    expect(buildComfyUIHeaders({ ...settings, userId: ' artist ' })).toEqual({
      Accept: 'application/json',
      'Comfy-User': 'artist',
    })
    expect(buildComfyUIHeaders({ ...settings, userId: '   ' })).toEqual({ Accept: 'application/json' })
    expect(() => buildComfyUIHeaders({ ...settings, userId: 'artist\r\nX-Test: injected' })).toThrow('invalid')
  })

  it('encodes non-ASCII Basic authentication credentials as UTF-8', () => {
    expect(buildComfyUIHeaders({ ...settings, username: '用户', password: '密码' }).Authorization).toBe(
      'Basic 55So5oi3OuWvhueggQ=='
    )
  })

  it('normalizes only HTTP endpoints without embedded credentials', () => {
    expect(normalizeComfyUIEndpoint('http://192.168.1.20:8188/')).toBe('http://192.168.1.20:8188')
    expect(() => normalizeComfyUIEndpoint('file:///tmp/comfy')).toThrow('HTTP or HTTPS')
    expect(() => normalizeComfyUIEndpoint('https://user:password@example.com')).toThrow('credentials')
  })

  it('accepts a wrapped API workflow and rejects UI graph JSON', () => {
    expect(parseComfyUIWorkflow(JSON.stringify({ prompt: JSON.parse(settings.workflowJson) }))).toHaveProperty('3')
    expect(() => parseComfyUIWorkflow('{"nodes":[]}')).toThrow('has no inputs object')
  })

  it('auto-detects standard nodes, injects generation parameters, and preserves workflow dimensions', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.5)
    const workflow = buildComfyUIPrompt(settings, {
      prompt: 'a futuristic city',
      checkpoint: 'new.safetensors',
      count: 3,
    }) as Record<string, { inputs: Record<string, unknown> }>

    expect(workflow['6'].inputs.text).toBe('a futuristic city')
    expect(workflow['7'].inputs.text).toBe('blurry')
    expect(workflow['4'].inputs.ckpt_name).toBe('new.safetensors')
    expect(workflow['5'].inputs).toMatchObject({ width: 512, height: 512, batch_size: 3 })
    expect(workflow['3'].inputs.seed).toBe(500_000_000_000_000)
  })

  it('overrides workflow-owned runtime parameters for one reproducible run', () => {
    const workflowJson = JSON.parse(settings.workflowJson) as Record<string, { inputs: Record<string, unknown> }>
    Object.assign(workflowJson['3'].inputs, {
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
    })
    const workflow = buildComfyUIPrompt(
      { ...settings, workflowJson: JSON.stringify(workflowJson) },
      {
        prompt: 'runtime',
        runtimeParameters: {
          width: 768,
          height: 640,
          steps: 32,
          cfg: 5.5,
          seed: 123,
          sampler: 'dpmpp_2m',
          scheduler: 'karras',
          denoise: 0.6,
        },
      }
    ) as Record<string, { inputs: Record<string, unknown> }>

    expect(workflow['5'].inputs).toMatchObject({ width: 768, height: 640 })
    expect(workflow['3'].inputs).toMatchObject({
      steps: 32,
      cfg: 5.5,
      seed: 123,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 0.6,
    })
  })

  it('reports missing workflow models before submission', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(['installed.safetensors']), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(['style.safetensors']), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))

    await expect(
      validateComfyUIModels(settings, {
        checkpoint: 'missing.safetensors',
        lora: 'style.safetensors',
        controlNet: 'canny.safetensors',
      })
    ).resolves.toEqual(['missing.safetensors', 'canny.safetensors'])
  })

  it('reports numeric dimensions detected in the workflow', () => {
    expect(inspectComfyUIWorkflowDimensions(settings.workflowJson, settings.inputMapping)).toEqual({
      width: 512,
      height: 512,
      configured: true,
    })
  })

  it('uses default width and height only when workflow values are missing or invalid', () => {
    const workflowJson = JSON.parse(settings.workflowJson) as Record<string, { inputs: Record<string, unknown> }>
    delete workflowJson['5'].inputs.width
    workflowJson['5'].inputs.height = 0
    const workflow = buildComfyUIPrompt(
      { ...settings, workflowJson: JSON.stringify(workflowJson), defaultWidth: 768, defaultHeight: 640 },
      { prompt: 'fallback size' }
    ) as Record<string, { inputs: Record<string, unknown> }>

    expect(workflow['5'].inputs).toMatchObject({ width: 768, height: 640 })
  })

  it('rejects text-to-image workflows whose dimension inputs cannot be identified', () => {
    const workflowJson = JSON.parse(settings.workflowJson) as Record<string, unknown>
    delete workflowJson['5']
    expect(() =>
      buildComfyUIPrompt({ ...settings, workflowJson: JSON.stringify(workflowJson) }, { prompt: 'missing size' })
    ).toThrow('no recognizable width and height inputs')
  })

  it('injects an uploaded reference image and permits image-derived latent dimensions', () => {
    const workflowJson = JSON.stringify({
      3: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, denoise: 0.75 } },
      6: { class_type: 'CLIPTextEncode', inputs: { text: '' } },
      7: { class_type: 'CLIPTextEncode', inputs: { text: '' } },
      11: { class_type: 'LoadImage', inputs: { image: 'placeholder.png' } },
      12: { class_type: 'VAEEncode', inputs: { pixels: ['11', 0] } },
    })
    const workflow = buildComfyUIPrompt(
      { ...settings, workflowJson, inputMapping: { image: '11.image' } },
      { prompt: 'restyle it', referenceImage: 'chatbox-upload.png' }
    ) as Record<string, { inputs: Record<string, unknown> }>

    expect(workflow['11'].inputs.image).toBe('chatbox-upload.png')
    expect(() =>
      buildComfyUIPrompt({ ...settings, workflowJson, inputMapping: { image: '11.image' } }, { prompt: 'missing' })
    ).toThrow('requires one reference image')
  })

  it('uploads reference images with Basic authentication and returns a subfolder path', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'input.png', subfolder: 'chatbox', type: 'input' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await expect(
      uploadComfyUIImage({ ...settings, username: 'artist', password: 'secret' }, 'data:image/png;base64,iVBORw0KGgo=')
    ).resolves.toBe('chatbox/input.png')
    const request = fetchMock.mock.calls.at(-1)?.[1]
    expect(request?.method).toBe('POST')
    expect(request?.headers).toMatchObject({ Authorization: 'Basic YXJ0aXN0OnNlY3JldA==' })
    expect(request?.body).toBeInstanceOf(FormData)
  })

  it('recovers from transient history and image-download failures after a background interruption', async () => {
    const image = new Blob(['png-data'], { type: 'image/png' })
    class TestFileReader {
      result: string | ArrayBuffer | null = null
      error: DOMException | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null

      readAsDataURL() {
        this.result = 'data:image/png;base64,cG5nLWRhdGE='
        this.onload?.()
      }
    }
    vi.stubGlobal('FileReader', TestFileReader)
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('temporary network loss'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            'prompt-1': {
              outputs: { output: { images: [{ filename: 'result.png', type: 'output' }] } },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockRejectedValueOnce(new TypeError('download socket was suspended'))
      .mockResolvedValueOnce(new Response(image, { status: 200, headers: { 'Content-Type': 'image/png' } }))

    try {
      await expect(
        waitForComfyUIImages({ ...settings, timeoutSeconds: 2, pollIntervalMs: 1 }, 'prompt-1')
      ).resolves.toEqual([expect.stringMatching(/^data:image\/png;base64,/)])
      expect(fetchMock).toHaveBeenCalledTimes(5)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not hide a permanent ComfyUI authentication failure behind polling retries', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(waitForComfyUIImages({ ...settings, pollIntervalMs: 1 }, 'prompt-1')).rejects.toMatchObject({
      status: 401,
    })
  })
})
