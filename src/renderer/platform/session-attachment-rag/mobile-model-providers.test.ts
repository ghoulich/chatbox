import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: {
    defaultEmbeddingModel: { provider: 'custom-provider', model: 'embedding-model' },
    defaultRerankModel: { provider: 'custom-provider', model: 'rerank-model' },
    licenseKey: undefined,
  } as Record<string, unknown>,
  createModel: vi.fn(),
  embedMany: vi.fn(),
  getProviderSettings: vi.fn(),
  post: vi.fn(),
}))

vi.mock('ai', () => ({ embedMany: mocks.embedMany }))
vi.mock('@/adapters', () => ({ createModel: mocks.createModel }))
vi.mock('@/settings-runtime', () => ({
  settingsService: { getSettings: () => mocks.settings },
}))
vi.mock('@/utils/request', () => ({ apiRequest: { post: mocks.post } }))
vi.mock('@shared/models', () => ({ getProviderSettings: mocks.getProviderSettings }))
vi.mock('@shared/request/chatboxai_pool', () => ({ getChatboxAPIOrigin: () => 'https://chatbox.example' }))

import { embedMobileSessionAttachmentValues, rerankMobileSessionAttachmentValues } from './mobile-model-providers'

describe('mobile session attachment model providers', () => {
  beforeEach(() => {
    mocks.createModel.mockReset()
    mocks.embedMany.mockReset()
    mocks.getProviderSettings.mockReset()
    mocks.post.mockReset()
  })

  it('uses the configured embedding model through the renderer model factory', async () => {
    const embeddingModel = { specificationVersion: 'v2', provider: 'test', modelId: 'embedding-model' }
    mocks.createModel.mockResolvedValue({
      modelId: 'embedding-model',
      getTextEmbeddingModel: () => embeddingModel,
    })
    mocks.embedMany.mockResolvedValue({
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    })

    const result = await embedMobileSessionAttachmentValues(['first', 'second'])

    expect(mocks.createModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'custom-provider', modelId: 'embedding-model' }),
    )
    expect(mocks.embedMany).toHaveBeenCalledWith({
      model: embeddingModel,
      values: ['first', 'second'],
      maxRetries: 0,
    })
    expect(result).toEqual({
      modelString: 'custom-provider:embedding-model',
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    })
  })

  it('calls the configured Cohere-compatible rerank endpoint through native-capable request routing', async () => {
    mocks.getProviderSettings.mockReturnValue({
      providerSetting: { apiKey: 'secret-key' },
      formattedApiHost: 'https://provider.example/v1/',
    })
    mocks.post.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.95 },
            { index: 0, relevance_score: 0.5 },
          ],
        }),
      ),
    )

    const result = await rerankMobileSessionAttachmentValues({
      modelString: 'custom-provider:rerank-model',
      query: 'needle',
      documents: ['first', 'second'],
      topK: 2,
    })

    expect(mocks.post).toHaveBeenCalledWith(
      'https://provider.example/v1/rerank',
      { Authorization: 'Bearer secret-key' },
      JSON.stringify({
        model: 'rerank-model',
        query: 'needle',
        documents: ['first', 'second'],
        top_n: 2,
      }),
      { retry: 0, useProxy: true },
    )
    expect(result).toEqual([
      { index: 1, score: 0.95 },
      { index: 0, score: 0.5 },
    ])
  })

  it('adds the OpenAI-compatible v1 prefix when the configured host omits it', async () => {
    mocks.getProviderSettings.mockReturnValue({
      providerSetting: { apiKey: 'secret-key' },
      formattedApiHost: 'https://provider.example',
    })
    mocks.post.mockResolvedValue(new Response(JSON.stringify({ results: [{ index: 0, relevance_score: 0.9 }] })))

    await rerankMobileSessionAttachmentValues({
      modelString: 'custom-provider:rerank-model',
      query: 'needle',
      documents: ['first'],
      topK: 1,
    })

    expect(mocks.post).toHaveBeenCalledWith(
      'https://provider.example/v1/rerank',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
  })
})
