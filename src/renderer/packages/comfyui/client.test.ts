import { describe, expect, it, vi } from 'vitest'
import {
  buildComfyUIHeaders,
  buildComfyUIPrompt,
  inspectComfyUIWorkflowDimensions,
  normalizeComfyUIEndpoint,
  parseComfyUIWorkflow,
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
} as const

describe('ComfyUI client helpers', () => {
  it('creates Basic authentication headers without exposing credentials in the endpoint', () => {
    expect(buildComfyUIHeaders(settings)).toEqual({ Accept: 'application/json' })
    expect(buildComfyUIHeaders({ ...settings, username: 'artist', password: 'secret' })).toEqual({
      Accept: 'application/json',
      Authorization: 'Basic YXJ0aXN0OnNlY3JldA==',
    })
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
})
