import { embedMany } from 'ai'
import type { CallChatCompletionOptions } from '@shared/models/types'
import type { ModelDependencies } from '@shared/types/adapters'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import { describe, expect, it, vi } from 'vitest'
import CustomOpenAI from './custom-openai'

class TestCustomOpenAI extends CustomOpenAI {
  public exposeTextEmbeddingModel() {
    return this.getTextEmbeddingModel({} as CallChatCompletionOptions)
  }
}

function createDependencies(apiRequest: ModelDependencies['request']['apiRequest']): ModelDependencies {
  return {
    request: { apiRequest, fetchWithOptions: vi.fn() },
    storage: { saveImage: vi.fn(), getImage: vi.fn() },
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn((callback: (scope: SentryScope) => void) => callback({ setTag: vi.fn(), setExtra: vi.fn() })),
    },
    getRemoteConfig: vi.fn(),
    platformType: 'mobile',
  }
}

describe('CustomOpenAI embeddings', () => {
  it('uses the host request adapter instead of global fetch', async () => {
    const apiRequest = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            object: 'list',
            data: [{ object: 'embedding', index: 0, embedding: [0.25, 0.75] }],
            model: 'embedding-test',
            usage: { prompt_tokens: 1, total_tokens: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('global fetch must not be used'))
    const model = new TestCustomOpenAI(
      {
        apiKey: 'test-key',
        apiHost: 'https://private-model.example/v1',
        apiPath: '/chat/completions',
        model: { modelId: 'embedding-test', type: 'chat', providerId: 'custom-test' },
        useProxy: true,
      },
      createDependencies(apiRequest),
    ).exposeTextEmbeddingModel()

    expect(model).not.toBeNull()
    const result = await embedMany({ model: model!, values: ['hello'], maxRetries: 0 })

    expect(result.embeddings).toEqual([[0.25, 0.75]])
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://private-model.example/v1/embeddings',
        method: 'POST',
        useProxy: true,
        retry: 0,
      }),
    )
    expect(globalFetch).not.toHaveBeenCalled()
    globalFetch.mockRestore()
  })
})
