import type {
  SessionAttachment,
  SessionAttachmentParent,
  SessionAttachmentQueryPlan,
  SessionAttachmentRagDebugSnapshot,
  SessionAttachmentRagMaintenanceResult,
  SessionAttachmentRagMaintenanceScope,
  SessionAttachmentSearchResult,
} from '@shared/types'
import type { SessionAttachmentRagController } from './interface'
import type { MobileEmbeddingResult, MobileRerankResult } from './mobile-model-providers'
import { SESSION_ATTACHMENT_RAG_INDEXING_FAILED_ERROR } from '@/stores/sessionAttachmentRagErrors'

const STATE_KEY = 'mobile-session-attachment-rag:v1'
const EMBEDDING_BATCH_SIZE = 32
const EMBEDDING_MAX_ATTEMPTS = 4
const EMBEDDING_RETRY_BASE_DELAY_MS = 1_000
const EMBEDDING_RETRY_MAX_DELAY_MS = 8_000
const PARENT_TARGET_CHARS = 1600
const CHILD_SIZE_CHARS = 448
const CHILD_OVERLAP_CHARS = 64

type MobileStatus = 'pending' | 'indexing' | 'ready' | 'failed'

interface MobileAttachmentRecord {
  id: number
  sessionId: string
  messageId: string
  attachmentStorageKey: string
  filename: string
  mimeType: string
  fileSize: number
  tokenEstimate: number
  parserType?: string
  status: MobileStatus
  indexingStage?: SessionAttachment['indexingStage']
  chunkCount: number
  totalChunks: number
  embeddedChunks: number
  embeddingModel?: string
  embeddingDimension?: number
  error?: string
  createdAt: number
  processingStartedAt?: number
  completedAt?: number
}

interface MobileParentRecord extends SessionAttachmentParent {}

interface MobileChunkRecord {
  attachmentId: number
  parentId: number
  sectionPath?: string
  chunkOrder: number
  rawText: string
  embeddedText: string
  vector?: string
}

interface MobileRagState {
  version: 1
  nextAttachmentId: number
  nextParentId: number
  attachments: MobileAttachmentRecord[]
  parents: MobileParentRecord[]
  chunks: MobileChunkRecord[]
}

export interface MobileSessionAttachmentRagStorage {
  getBlob(key: string): Promise<string | null>
  setBlob(key: string, value: string): Promise<void>
  deleteBlob(key: string): Promise<void>
}

export interface MobileSessionAttachmentRagDependencies {
  embed(values: string[]): Promise<MobileEmbeddingResult>
  rerank(params: {
    modelString: string
    query: string
    documents: string[]
    topK: number
  }): Promise<MobileRerankResult[]>
  now?: () => number
  schedule?: (task: () => void) => void
  delay?: (milliseconds: number) => Promise<void>
  log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRetryableEmbeddingError(error: unknown): boolean {
  const normalized = errorMessage(error).toLowerCase()
  if (
    normalized.includes('status code 400') ||
    normalized.includes('status code 401') ||
    normalized.includes('status code 403') ||
    normalized.includes('status code 422') ||
    normalized.includes('invalid embedding model') ||
    normalized.includes('does not support text embeddings') ||
    normalized.includes('does not provide a text embedding model') ||
    normalized.includes('embedding model is not configured') ||
    normalized.includes('missing token')
  ) {
    return false
  }
  return (
    normalized.includes('failed to fetch') ||
    normalized.includes('network error') ||
    normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('connection') ||
    normalized.includes('status code 404') ||
    normalized.includes('status code 408') ||
    normalized.includes('status code 409') ||
    normalized.includes('status code 425') ||
    normalized.includes('status code 429') ||
    /status code 5\d\d/.test(normalized)
  )
}

function indexingError(error: unknown): string {
  const message = errorMessage(error)
  return message.startsWith(SESSION_ATTACHMENT_RAG_INDEXING_FAILED_ERROR)
    ? message
    : `${SESSION_ATTACHMENT_RAG_INDEXING_FAILED_ERROR}: ${message}`
}

function getContiguousEmbeddedChunkCount(chunks: MobileChunkRecord[]): number {
  let count = 0
  for (const chunk of chunks) {
    if (!chunk.vector) break
    count++
  }
  return count
}

function emptyState(): MobileRagState {
  return {
    version: 1,
    nextAttachmentId: 1,
    nextParentId: 1,
    attachments: [],
    parents: [],
    chunks: [],
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function splitParentBlocks(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const paragraphs = normalized.split(/\n{2,}/)
  const parents: string[] = []
  let current = ''

  const flush = () => {
    const value = current.trim()
    if (value) parents.push(value)
    current = ''
  }

  for (const paragraph of paragraphs) {
    const value = paragraph.trim()
    if (!value) continue
    if (value.length > PARENT_TARGET_CHARS) {
      flush()
      for (let offset = 0; offset < value.length; offset += PARENT_TARGET_CHARS) {
        parents.push(value.slice(offset, offset + PARENT_TARGET_CHARS))
      }
      continue
    }
    if (current && current.length + 2 + value.length > PARENT_TARGET_CHARS) flush()
    current = current ? `${current}\n\n${value}` : value
  }
  flush()
  return parents
}

function buildRecords(
  state: MobileRagState,
  attachment: MobileAttachmentRecord,
  content: string
): { parents: MobileParentRecord[]; chunks: MobileChunkRecord[] } {
  const parents: MobileParentRecord[] = []
  const chunks: MobileChunkRecord[] = []
  for (const [parentOrder, text] of splitParentBlocks(content).entries()) {
    const parentId = state.nextParentId++
    parents.push({
      id: parentId,
      attachmentId: attachment.id,
      filename: attachment.filename,
      docType: attachment.mimeType,
      parentOrder,
      text,
      tokenEstimate: estimateTokens(text),
      charCount: text.length,
    })
    let offset = 0
    while (offset < text.length) {
      const rawText = text.slice(offset, offset + CHILD_SIZE_CHARS).trim()
      if (rawText) {
        chunks.push({
          attachmentId: attachment.id,
          parentId,
          chunkOrder: chunks.length,
          rawText,
          embeddedText: `[${attachment.filename}]\n${rawText}`,
        })
      }
      if (offset + CHILD_SIZE_CHARS >= text.length) break
      offset += CHILD_SIZE_CHARS - CHILD_OVERLAP_CHARS
    }
  }
  return { parents, chunks }
}

function encodeVector(vector: number[]): string {
  const floats = Float32Array.from(vector)
  const bytes = new Uint8Array(floats.buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function decodeVector(encoded: string): Float32Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Float32Array(bytes.buffer)
}

function cosineSimilarity(left: Float32Array, right: number[]): number {
  if (left.length !== right.length || left.length === 0) return Number.NEGATIVE_INFINITY
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index++) {
    const a = left[index]
    const b = right[index]
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) return Number.NEGATIVE_INFINITY
  return dot / Math.sqrt(leftNorm * rightNorm)
}

function dedupeByParent<T extends { parentId: number }>(items: T[]): T[] {
  const seen = new Set<number>()
  return items.filter((item) => {
    if (seen.has(item.parentId)) return false
    seen.add(item.parentId)
    return true
  })
}

export default class MobileSessionAttachmentRagController implements SessionAttachmentRagController {
  private statePromise?: Promise<MobileRagState>
  private persistQueue: Promise<void> = Promise.resolve()
  private indexing = new Set<number>()
  private readonly now: () => number
  private readonly schedule: (task: () => void) => void
  private readonly delay: (milliseconds: number) => Promise<void>
  private readonly log: NonNullable<MobileSessionAttachmentRagDependencies['log']>

  constructor(
    private readonly storage: MobileSessionAttachmentRagStorage,
    private readonly dependencies: MobileSessionAttachmentRagDependencies
  ) {
    this.now = dependencies.now ?? Date.now
    this.schedule = dependencies.schedule ?? ((task) => globalThis.setTimeout(task, 0))
    this.delay =
      dependencies.delay ?? ((milliseconds) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)))
    this.log = dependencies.log ?? (() => undefined)
  }

  private async getState(): Promise<MobileRagState> {
    if (!this.statePromise) {
      const statePromise: Promise<MobileRagState> = this.storage
        .getBlob(STATE_KEY)
        .then((value) => {
          if (!value) return emptyState()
          const parsed = JSON.parse(value) as Partial<MobileRagState>
          if (parsed.version !== 1 || !Array.isArray(parsed.attachments)) return emptyState()
          const state: MobileRagState = {
            version: 1 as const,
            nextAttachmentId: parsed.nextAttachmentId ?? 1,
            nextParentId: parsed.nextParentId ?? 1,
            attachments: parsed.attachments,
            parents: Array.isArray(parsed.parents) ? parsed.parents : [],
            chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
          }
          for (const attachment of state.attachments) {
            if (
              attachment.status === 'failed' &&
              attachment.totalChunks > 0 &&
              attachment.error &&
              !attachment.error.startsWith(SESSION_ATTACHMENT_RAG_INDEXING_FAILED_ERROR)
            ) {
              attachment.error = indexingError(attachment.error)
            }
          }
          return state
        })
        .catch(() => emptyState())
      this.statePromise = statePromise
      return statePromise
    }
    return this.statePromise
  }

  private async persist(state: MobileRagState): Promise<void> {
    const serialized = JSON.stringify(state)
    this.persistQueue = this.persistQueue.catch(() => undefined).then(() => this.storage.setBlob(STATE_KEY, serialized))
    await this.persistQueue
  }

  private toPublic(record: MobileAttachmentRecord): SessionAttachment {
    return {
      ...record,
      availability: 'allowed',
      indexStatus: record.status,
      resumable: record.status === 'failed' && record.embeddedChunks > 0,
    }
  }

  private queueIndex(attachmentId: number) {
    if (this.indexing.has(attachmentId)) return
    this.schedule(() => {
      void this.indexAttachment(attachmentId)
    })
  }

  private async embedBatchWithRetry(params: {
    attachmentId: number
    offset: number
    values: string[]
  }): Promise<MobileEmbeddingResult> {
    let lastError: unknown
    for (let attempt = 1; attempt <= EMBEDDING_MAX_ATTEMPTS; attempt++) {
      try {
        return await this.dependencies.embed(params.values)
      } catch (error) {
        lastError = error
        if (attempt >= EMBEDDING_MAX_ATTEMPTS || !isRetryableEmbeddingError(error)) throw error
        const delayMs = Math.min(EMBEDDING_RETRY_MAX_DELAY_MS, EMBEDDING_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
        this.log(
          'warn',
          `[session-attachment-rag] Mobile embedding batch retry: attachmentId=${params.attachmentId}, offset=${params.offset}, attempt=${attempt + 1}/${EMBEDDING_MAX_ATTEMPTS}, delayMs=${delayMs}, error=${errorMessage(error)}`
        )
        await this.delay(delayMs)
      }
    }
    throw lastError
  }

  private async indexAttachment(attachmentId: number): Promise<void> {
    if (this.indexing.has(attachmentId)) return
    this.indexing.add(attachmentId)
    try {
      const state = await this.getState()
      const attachment = state.attachments.find((item) => item.id === attachmentId)
      if (!attachment) return

      attachment.status = 'indexing'
      attachment.indexingStage = 'chunking'
      attachment.processingStartedAt = this.now()
      attachment.completedAt = undefined
      attachment.error = undefined
      let parents = state.parents
        .filter((item) => item.attachmentId === attachmentId)
        .sort((left, right) => left.parentOrder - right.parentOrder)
      let chunks = state.chunks
        .filter((item) => item.attachmentId === attachmentId)
        .sort((left, right) => left.chunkOrder - right.chunkOrder)
      const parentIds = new Set(parents.map((item) => item.id))
      const checkpointIsValid =
        parents.length > 0 &&
        chunks.length > 0 &&
        chunks.length === attachment.totalChunks &&
        chunks.every((chunk, index) => chunk.chunkOrder === index && parentIds.has(chunk.parentId))

      let resumeOffset = checkpointIsValid ? getContiguousEmbeddedChunkCount(chunks) : 0
      if (!checkpointIsValid) {
        state.parents = state.parents.filter((item) => item.attachmentId !== attachmentId)
        state.chunks = state.chunks.filter((item) => item.attachmentId !== attachmentId)
        attachment.chunkCount = 0
        attachment.totalChunks = 0
        attachment.embeddedChunks = 0
        attachment.embeddingModel = undefined
        attachment.embeddingDimension = undefined
        await this.persist(state)

        const content = await this.storage.getBlob(attachment.attachmentStorageKey)
        if (!content?.trim()) throw new Error('Parsed attachment content is empty or missing')
        const records = buildRecords(state, attachment, content)
        if (records.chunks.length === 0) throw new Error('No searchable text chunks were produced')
        parents = records.parents
        chunks = records.chunks
        state.parents.push(...parents)
        state.chunks.push(...chunks)
        attachment.chunkCount = chunks.length
        attachment.totalChunks = chunks.length
        attachment.embeddedChunks = 0
        attachment.indexingStage = 'embedding'
        await this.persist(state)
      } else {
        // Only a contiguous prefix is a valid checkpoint. Discard any vectors after a gap.
        for (let index = resumeOffset; index < chunks.length; index++) chunks[index].vector = undefined
        attachment.chunkCount = chunks.length
        attachment.totalChunks = chunks.length
        attachment.embeddedChunks = resumeOffset
        attachment.indexingStage = 'embedding'
        await this.persist(state)
        this.log(
          'info',
          `[session-attachment-rag] Mobile index resumed: attachmentId=${attachment.id}, offset=${resumeOffset}, totalChunks=${chunks.length}`
        )
      }

      let expectedDimension = resumeOffset > 0 ? attachment.embeddingDimension : undefined
      let embeddingModel = resumeOffset > 0 ? attachment.embeddingModel : undefined
      for (let offset = resumeOffset; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
        if (!state.attachments.some((item) => item.id === attachmentId)) return
        const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE)
        const result = await this.embedBatchWithRetry({
          attachmentId,
          offset,
          values: batch.map((item) => item.embeddedText),
        })
        if (result.embeddings.length !== batch.length) {
          throw new Error(`Embedding provider returned ${result.embeddings.length} vectors for ${batch.length} chunks`)
        }
        if (embeddingModel && embeddingModel !== result.modelString) {
          throw new Error('Embedding model changed while indexing the attachment')
        }
        embeddingModel = result.modelString
        for (let index = 0; index < batch.length; index++) {
          const vector = result.embeddings[index]
          if (!vector?.length) throw new Error('Embedding provider returned an empty vector')
          expectedDimension ??= vector.length
          if (vector.length !== expectedDimension) throw new Error('Embedding dimensions are inconsistent')
          batch[index].vector = encodeVector(vector)
        }
        attachment.embeddingModel = embeddingModel
        attachment.embeddingDimension = expectedDimension
        attachment.embeddedChunks = Math.min(offset + batch.length, chunks.length)
        await this.persist(state)
      }

      attachment.status = 'ready'
      attachment.indexingStage = 'ready'
      attachment.completedAt = this.now()
      await this.persist(state)
      this.log(
        'info',
        `[session-attachment-rag] Mobile index ready: attachmentId=${attachment.id}, model=${attachment.embeddingModel ?? 'unknown'}, chunks=${attachment.chunkCount}, dimension=${attachment.embeddingDimension ?? 0}, durationMs=${attachment.completedAt - (attachment.processingStartedAt ?? attachment.createdAt)}`
      )
    } catch (error) {
      const state = await this.getState()
      const attachment = state.attachments.find((item) => item.id === attachmentId)
      if (attachment) {
        attachment.status = 'failed'
        const rawError = errorMessage(error)
        attachment.error = attachment.indexingStage === 'embedding' ? indexingError(error) : rawError
        await this.persist(state)
        this.log(
          'error',
          `[session-attachment-rag] Mobile index failed: attachmentId=${attachment.id}, embeddedChunks=${attachment.embeddedChunks}/${attachment.totalChunks}, error=${rawError}`
        )
      }
    } finally {
      this.indexing.delete(attachmentId)
    }
  }

  async create(params: {
    sessionId: string
    messageId: string
    attachmentStorageKey: string
    filename: string
    mimeType: string
    fileSize: number
    tokenEstimate: number
    parserType?: string
  }): Promise<SessionAttachment> {
    const state = await this.getState()
    const record: MobileAttachmentRecord = {
      ...params,
      id: state.nextAttachmentId++,
      status: 'pending',
      indexingStage: 'queued',
      chunkCount: 0,
      totalChunks: 0,
      embeddedChunks: 0,
      createdAt: this.now(),
    }
    state.attachments.push(record)
    await this.persist(state)
    this.log(
      'info',
      `[session-attachment-rag] Mobile index queued: attachmentId=${record.id}, bytes=${record.fileSize}, filename=${record.filename}`
    )
    this.queueIndex(record.id)
    return this.toPublic(record)
  }

  async getAttachments(ids: number[]): Promise<SessionAttachment[]> {
    const idSet = new Set(ids)
    const state = await this.getState()
    return state.attachments.filter((item) => idSet.has(item.id)).map((item) => this.toPublic(item))
  }

  async retryAttachment(attachmentId: number): Promise<void> {
    const state = await this.getState()
    const attachment = state.attachments.find((item) => item.id === attachmentId)
    if (!attachment) return
    attachment.status = 'pending'
    attachment.indexingStage = 'queued'
    attachment.error = undefined
    await this.persist(state)
    this.queueIndex(attachmentId)
  }

  async rebindAttachment(params: { attachmentId: number; sessionId: string; messageId: string }): Promise<void> {
    const state = await this.getState()
    const attachment = state.attachments.find((item) => item.id === params.attachmentId)
    if (!attachment) return
    attachment.sessionId = params.sessionId
    attachment.messageId = params.messageId
    await this.persist(state)
  }

  private async deleteIds(ids: number[]): Promise<number[]> {
    if (ids.length === 0) return []
    const state = await this.getState()
    const idSet = new Set(ids)
    const deleted = state.attachments.filter((item) => idSet.has(item.id)).map((item) => item.id)
    state.attachments = state.attachments.filter((item) => !idSet.has(item.id))
    state.parents = state.parents.filter((item) => !idSet.has(item.attachmentId))
    state.chunks = state.chunks.filter((item) => !idSet.has(item.attachmentId))
    await this.persist(state)
    return deleted
  }

  async deleteAttachment(attachmentId: number): Promise<void> {
    await this.deleteIds([attachmentId])
  }

  async deleteMessageAttachments(messageId: string): Promise<number[]> {
    const state = await this.getState()
    return this.deleteIds(state.attachments.filter((item) => item.messageId === messageId).map((item) => item.id))
  }

  async deleteSessionAttachments(sessionId: string): Promise<number[]> {
    const state = await this.getState()
    return this.deleteIds(state.attachments.filter((item) => item.sessionId === sessionId).map((item) => item.id))
  }

  async cleanupOrphans(params: { sessionIds: string[]; messageIds: string[] }): Promise<number[]> {
    const state = await this.getState()
    const sessionIds = new Set(params.sessionIds)
    const messageIds = new Set(params.messageIds)
    return this.deleteIds(
      state.attachments
        .filter((item) => !sessionIds.has(item.sessionId) || !messageIds.has(item.messageId))
        .map((item) => item.id)
    )
  }

  async getDebugSnapshot(): Promise<SessionAttachmentRagDebugSnapshot> {
    const state = await this.getState()
    const serializedSize = JSON.stringify(state).length
    const statusCounts = { pending: 0, indexing: 0, ready: 0, failed: 0 }
    for (const attachment of state.attachments) statusCounts[attachment.status]++
    return {
      dbPath: STATE_KEY,
      dbSizeBytes: serializedSize,
      vectorDbPath: STATE_KEY,
      vectorDbSizeBytes: state.chunks.reduce((sum, item) => sum + (item.vector?.length ?? 0), 0),
      attachmentCount: state.attachments.length,
      parentCount: state.parents.length,
      chunkCount: state.chunks.length,
      vectorIndexNames: state.attachments.map((item) => `mobile_sa_${item.id}`),
      statusCounts,
      recentAttachments: state.attachments.slice(-20).map((item) => ({
        id: item.id,
        sessionId: item.sessionId,
        messageId: item.messageId,
        filename: item.filename,
        parserType: item.parserType,
        status: item.status,
        chunkCount: item.chunkCount,
        error: item.error,
        createdAt: item.createdAt,
        processingStartedAt: item.processingStartedAt,
        completedAt: item.completedAt,
      })),
    }
  }

  async clearAll(): Promise<number> {
    const state = await this.getState()
    const count = state.attachments.length
    const cleared = emptyState()
    state.nextAttachmentId = cleared.nextAttachmentId
    state.nextParentId = cleared.nextParentId
    state.attachments = []
    state.parents = []
    state.chunks = []
    this.statePromise = Promise.resolve(state)
    await this.persist(state)
    await this.storage.deleteBlob(STATE_KEY)
    return count
  }

  async runMaintenance(params: SessionAttachmentRagMaintenanceScope): Promise<SessionAttachmentRagMaintenanceResult> {
    const state = await this.getState()
    const claims = new Map(params.attachmentReferences.map((claim) => [claim.attachmentId, claim]))
    for (const attachment of state.attachments) {
      const claim = claims.get(attachment.id)
      if (claim) {
        attachment.sessionId = claim.sessionId
        attachment.messageId = claim.messageId
      }
    }
    await this.persist(state)
    const orphanDeletedIds = await this.cleanupOrphans(params)
    for (const attachment of state.attachments) {
      if (attachment.status === 'pending' || attachment.status === 'indexing') {
        attachment.status = 'pending'
        attachment.indexingStage = 'queued'
        this.queueIndex(attachment.id)
      }
    }
    await this.persist(state)
    return { interruptedFailedCount: 0, canceledPurgedCount: 0, orphanDeletedIds }
  }

  async query(params: {
    attachmentIds: number[]
    query: string
    plan: SessionAttachmentQueryPlan
  }): Promise<SessionAttachmentSearchResult[]> {
    if (!params.query.trim() || params.attachmentIds.length === 0) return []
    const state = await this.getState()
    const readyIds = new Set(
      state.attachments
        .filter((item) => params.attachmentIds.includes(item.id) && item.status === 'ready')
        .map((item) => item.id)
    )
    if (readyIds.size === 0) return []
    const queryEmbedding = await this.dependencies.embed([params.query])
    const queryVector = queryEmbedding.embeddings[0]
    if (!queryVector?.length) throw new Error('Embedding provider returned an empty query vector')

    const candidates = state.chunks
      .filter((item) => readyIds.has(item.attachmentId) && item.vector)
      .map((item) => ({ ...item, score: cosineSimilarity(decodeVector(item.vector!), queryVector) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(params.plan.recallTopK, 20)))

    this.log(
      'info',
      `[session-attachment-rag] Mobile query vector recall: attachments=${readyIds.size}, candidates=${candidates.length}, rerank=${Boolean(params.plan.rerank?.enabled && params.plan.rerank.model)}`
    )

    let ranked = candidates
    if (params.plan.rerank?.enabled && params.plan.rerank.model && candidates.length > 0) {
      try {
        const reranked = await this.dependencies.rerank({
          modelString: params.plan.rerank.model,
          query: params.query,
          documents: candidates.map((item) => item.embeddedText),
          topK: candidates.length,
        })
        ranked = reranked.map((item) => ({ ...candidates[item.index], score: item.score })).filter(Boolean)
        this.log(
          'info',
          `[session-attachment-rag] Mobile query reranked: model=${params.plan.rerank.model}, results=${ranked.length}`
        )
      } catch (error) {
        this.log(
          'warn',
          `[session-attachment-rag] Mobile reranking failed; using vector ranking: ${error instanceof Error ? error.message : String(error)}`
        )
        console.warn('[session-attachment-rag] Mobile reranking failed; using vector ranking', error)
      }
    }

    const attachmentsById = new Map(state.attachments.map((item) => [item.id, item]))
    return dedupeByParent(ranked)
      .slice(0, Math.max(1, Math.min(params.plan.finalTopK, 12)))
      .map((item) => ({
        attachmentId: item.attachmentId,
        parentId: item.parentId,
        filename: attachmentsById.get(item.attachmentId)?.filename ?? 'attachment',
        sectionPath: item.sectionPath,
        chunkOrder: item.chunkOrder,
        text: item.rawText,
        score: item.score,
      }))
  }

  async readParents(params: { parentIds: number[]; attachmentIds: number[] }): Promise<SessionAttachmentParent[]> {
    const parentIds = new Set(params.parentIds)
    const attachmentIds = new Set(params.attachmentIds)
    const state = await this.getState()
    return state.parents.filter((item) => parentIds.has(item.id) && attachmentIds.has(item.attachmentId))
  }
}
