import type { EmbeddingModel } from 'ai'
import { embedMany } from 'ai'
import { createModel } from '@/adapters'
import { settingsService } from '@/settings-runtime'
import { apiRequest } from '@/utils/request'
import { getProviderSettings } from '@shared/models'
import type { CallChatCompletionOptions, ModelInterface } from '@shared/models/types'
import { getChatboxAPIOrigin } from '@shared/request/chatboxai_pool'
import { SessionSettingsSchema } from '@shared/types'
import { parseKnowledgeBaseModelString } from '@shared/utils/knowledge-base-model-parser'
import { normalizeOpenAIApiHostAndPath } from '@shared/utils/llm_utils'

interface EmbeddingCapableModel {
  getTextEmbeddingModel(options: CallChatCompletionOptions): EmbeddingModel | null
}

export interface MobileEmbeddingResult {
  embeddings: number[][]
  modelString: string
}

export interface MobileRerankResult {
  index: number
  score: number
}

function getEmbeddingModel(model: ModelInterface): EmbeddingModel {
  const getTextEmbeddingModel = (model as unknown as Partial<EmbeddingCapableModel>).getTextEmbeddingModel
  if (typeof getTextEmbeddingModel !== 'function') {
    throw new Error(`Model ${model.modelId} does not support text embeddings`)
  }
  const embeddingModel = getTextEmbeddingModel.call(model, {})
  if (!embeddingModel) {
    throw new Error(`Model ${model.modelId} does not provide a text embedding model`)
  }
  return embeddingModel
}

function getConfiguredEmbeddingModelString(): string {
  const settings = settingsService.getSettings()
  const selection = settings.defaultEmbeddingModel
  if (selection?.provider && selection.model) {
    return `${selection.provider}:${selection.model}`
  }
  if (settings.licenseKey) {
    return 'chatbox-ai:text-embedding-3-small'
  }
  throw new Error('Session attachment embedding model is not configured')
}

export async function embedMobileSessionAttachmentValues(values: string[]): Promise<MobileEmbeddingResult> {
  const modelString = getConfiguredEmbeddingModelString()
  const parsed = parseKnowledgeBaseModelString(modelString)
  if (!parsed) {
    throw new Error(`Invalid embedding model format: ${modelString}`)
  }

  const settings = settingsService.getSettings()
  const model = await createModel(
    SessionSettingsSchema.parse({
      ...settings,
      provider: parsed.providerId,
      modelId: parsed.modelId,
    }),
  )
  const result = await embedMany({
    model: getEmbeddingModel(model),
    values,
    maxRetries: 0,
  })
  return { embeddings: result.embeddings, modelString }
}

function normalizeRerankEndpoint(apiHost: string): string {
  const normalizedHost = normalizeOpenAIApiHostAndPath({ apiHost }).apiHost
  return `${normalizedHost.replace(/\/+$/, '')}/rerank`
}

function readRerankResults(payload: unknown, documentCount: number): MobileRerankResult[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { results?: unknown }).results)) {
    throw new Error('Rerank provider returned an invalid response')
  }
  const results: MobileRerankResult[] = []
  for (const item of (payload as { results: unknown[] }).results) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const index = Number(record.index)
    const score = Number(record.relevance_score ?? record.relevanceScore ?? record.score)
    if (Number.isInteger(index) && index >= 0 && index < documentCount && Number.isFinite(score)) {
      results.push({ index, score })
    }
  }
  if (results.length === 0 && documentCount > 0) {
    throw new Error('Rerank provider returned no usable results')
  }
  return results
}

export async function rerankMobileSessionAttachmentValues(params: {
  modelString: string
  query: string
  documents: string[]
  topK: number
}): Promise<MobileRerankResult[]> {
  const parsed = parseKnowledgeBaseModelString(params.modelString)
  if (!parsed) {
    throw new Error(`Invalid rerank model format: ${params.modelString}`)
  }

  const settings = settingsService.getSettings()
  const { providerSetting, formattedApiHost } = getProviderSettings(
    { ...settings, provider: parsed.providerId, modelId: parsed.modelId },
    settings,
  )
  const apiHost = parsed.providerId === 'chatbox-ai' ? getChatboxAPIOrigin() : formattedApiHost
  const token = parsed.providerId === 'chatbox-ai' ? settings.licenseKey : providerSetting.apiKey
  if (!token) {
    throw new Error(`Missing token for rerank provider: ${parsed.providerId}`)
  }

  const response = await apiRequest.post(
    normalizeRerankEndpoint(apiHost),
    { Authorization: `Bearer ${token}` },
    JSON.stringify({
      model: parsed.modelId,
      query: params.query,
      documents: params.documents,
      top_n: Math.max(1, Math.min(params.topK, params.documents.length)),
    }),
    { retry: 0, useProxy: true },
  )
  return readRerankResults(await response.json(), params.documents.length)
}
