import { describe, expect, it, vi } from 'vitest'
import MobileSessionAttachmentRagController, {
  type MobileSessionAttachmentRagDependencies,
  type MobileSessionAttachmentRagStorage,
} from './mobile-controller'

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const storage: MobileSessionAttachmentRagStorage = {
    getBlob: vi.fn(async (key) => values.get(key) ?? null),
    setBlob: vi.fn(async (key, value) => {
      values.set(key, value)
    }),
    deleteBlob: vi.fn(async (key) => {
      values.delete(key)
    }),
  }
  return { values, storage }
}

async function waitUntilReady(controller: MobileSessionAttachmentRagController, id: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const [attachment] = await controller.getAttachments([id])
    if (attachment?.status === 'ready' || attachment?.status === 'failed') return attachment
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Attachment indexing did not finish')
}

describe('MobileSessionAttachmentRagController', () => {
  it('indexes, persists, searches, reranks and reads parent blocks', async () => {
    const content = [
      'General introduction with ordinary information.',
      '',
      'The unique retrieval needle is BLUE-LANTERN-731905 and this paragraph contains the decisive fact.',
      '',
      'Closing notes that are unrelated to the requested fact.',
    ].join('\n')
    const { values, storage } = createStorage({ parsed: content })
    const embed = vi.fn(async (texts: string[]) => ({
      modelString: 'custom:embedding',
      embeddings: texts.map((text) => (text.includes('BLUE-LANTERN') || text.includes('needle') ? [1, 0] : [0, 1])),
    }))
    const rerank = vi.fn(async ({ documents }: { documents: string[] }) =>
      documents.map((_document, index) => ({ index, score: 1 - index / 10 }))
    ) as MobileSessionAttachmentRagDependencies['rerank']
    const controller = new MobileSessionAttachmentRagController(storage, { embed, rerank })

    const created = await controller.create({
      sessionId: 'session-1',
      messageId: 'message-1',
      attachmentStorageKey: 'parsed',
      filename: 'notes.txt',
      mimeType: 'text/plain',
      fileSize: content.length,
      tokenEstimate: 50,
      parserType: 'local',
    })
    const ready = await waitUntilReady(controller, created.id)

    expect(ready.status).toBe('ready')
    expect(ready.embeddingModel).toBe('custom:embedding')
    expect(ready.embeddedChunks).toBe(ready.totalChunks)
    const results = await controller.query({
      attachmentIds: [created.id],
      query: 'Where is the BLUE-LANTERN needle?',
      plan: { recallTopK: 20, finalTopK: 8, rerank: { enabled: true, model: 'custom:reranker' } },
    })

    expect(results[0].text).toContain('BLUE-LANTERN-731905')
    expect(rerank).toHaveBeenCalledOnce()
    const parents = await controller.readParents({
      parentIds: [results[0].parentId],
      attachmentIds: [created.id],
    })
    expect(parents[0].text).toContain('BLUE-LANTERN-731905')

    const restored = new MobileSessionAttachmentRagController(storage, { embed, rerank })
    expect((await restored.getAttachments([created.id]))[0].status).toBe('ready')
    expect(values.get('mobile-session-attachment-rag:v1')).toContain('custom:embedding')
  })

  it('falls back to vector ranking when reranking fails and removes attachment data', async () => {
    const { storage } = createStorage({ parsed: 'needle fact\n\nunrelated fact' })
    const controller = new MobileSessionAttachmentRagController(storage, {
      embed: async (texts) => ({
        modelString: 'custom:embedding',
        embeddings: texts.map((text) => (text.includes('needle') ? [1, 0] : [0, 1])),
      }),
      rerank: async () => {
        throw new Error('reranker unavailable')
      },
    })
    const created = await controller.create({
      sessionId: 'session-2',
      messageId: 'message-2',
      attachmentStorageKey: 'parsed',
      filename: 'fallback.txt',
      mimeType: 'text/plain',
      fileSize: 30,
      tokenEstimate: 8,
    })
    expect((await waitUntilReady(controller, created.id)).status).toBe('ready')

    const results = await controller.query({
      attachmentIds: [created.id],
      query: 'needle',
      plan: { recallTopK: 20, finalTopK: 8, rerank: { enabled: true, model: 'custom:reranker' } },
    })
    expect(results[0].text).toContain('needle')
    await controller.deleteSessionAttachments('session-2')
    expect(await controller.getAttachments([created.id])).toEqual([])
    expect((await controller.getDebugSnapshot()).chunkCount).toBe(0)
  })

  it('marks missing parsed content as failed and can clear persisted state', async () => {
    const { values, storage } = createStorage()
    const controller = new MobileSessionAttachmentRagController(storage, {
      embed: vi.fn(),
      rerank: vi.fn(),
    })
    const created = await controller.create({
      sessionId: 'session-3',
      messageId: 'message-3',
      attachmentStorageKey: 'missing',
      filename: 'missing.txt',
      mimeType: 'text/plain',
      fileSize: 1,
      tokenEstimate: 1,
    })
    const failed = await waitUntilReady(controller, created.id)
    expect(failed.status).toBe('failed')
    expect(failed.error).toContain('missing')
    expect(await controller.clearAll()).toBe(1)
    expect(values.has('mobile-session-attachment-rag:v1')).toBe(false)
  })

  it('retries a transient embedding batch with exponential backoff', async () => {
    const { storage } = createStorage({ parsed: 'transient retry content '.repeat(1_500) })
    const delay = vi.fn(async () => undefined)
    let callCount = 0
    const embed = vi.fn(async (texts: string[]) => {
      callCount++
      if (callCount === 2 || callCount === 3) {
        throw new Error('API Error: Status Code 404')
      }
      return {
        modelString: 'custom:embedding',
        embeddings: texts.map(() => [1, 0]),
      }
    })
    const controller = new MobileSessionAttachmentRagController(storage, {
      embed,
      rerank: vi.fn(),
      delay,
    })

    const created = await controller.create({
      sessionId: 'session-retry',
      messageId: 'message-retry',
      attachmentStorageKey: 'parsed',
      filename: 'retry.txt',
      mimeType: 'text/plain',
      fileSize: 30_000,
      tokenEstimate: 7_500,
    })

    const ready = await waitUntilReady(controller, created.id)
    expect(ready.status).toBe('ready')
    expect(delay.mock.calls).toEqual([[1_000], [2_000]])
    expect(ready.embeddedChunks).toBe(ready.totalChunks)
  })

  it('persists completed batches and resumes from the first missing vector', async () => {
    const { storage } = createStorage({ parsed: 'checkpoint content '.repeat(2_000) })
    let firstRunCalls = 0
    const firstEmbed = vi.fn(async (texts: string[]) => {
      firstRunCalls++
      if (firstRunCalls > 1) throw new Error('Network Error: Failed to fetch')
      return {
        modelString: 'custom:embedding',
        embeddings: texts.map(() => [1, 0]),
      }
    })
    const firstController = new MobileSessionAttachmentRagController(storage, {
      embed: firstEmbed,
      rerank: vi.fn(),
      delay: async () => undefined,
    })
    const created = await firstController.create({
      sessionId: 'session-resume',
      messageId: 'message-resume',
      attachmentStorageKey: 'parsed',
      filename: 'resume.txt',
      mimeType: 'text/plain',
      fileSize: 38_000,
      tokenEstimate: 9_500,
    })

    const failed = await waitUntilReady(firstController, created.id)
    expect(failed.status).toBe('failed')
    expect(failed.embeddedChunks).toBe(32)
    expect(failed.resumable).toBe(true)
    expect(failed.error).toContain('session_attachment_rag_indexing_failed')
    expect(firstEmbed).toHaveBeenCalledTimes(5)

    const resumedLog = vi.fn()
    const resumedEmbed = vi.fn(async (texts: string[]) => ({
      modelString: 'custom:embedding',
      embeddings: texts.map(() => [1, 0]),
    }))
    const restoredController = new MobileSessionAttachmentRagController(storage, {
      embed: resumedEmbed,
      rerank: vi.fn(),
      delay: async () => undefined,
      log: resumedLog,
    })
    await restoredController.retryAttachment(created.id)
    const ready = await waitUntilReady(restoredController, created.id)

    expect(ready.status).toBe('ready')
    expect(ready.embeddedChunks).toBe(ready.totalChunks)
    expect(resumedEmbed.mock.calls.length).toBeLessThan(firstEmbed.mock.calls.length)
    expect(resumedLog).toHaveBeenCalledWith(
      'info',
      expect.stringContaining(`Mobile index resumed: attachmentId=${created.id}, offset=32`)
    )
  })

  it('does not retry a configuration error or offer a nonexistent checkpoint', async () => {
    const { storage } = createStorage({ parsed: 'configuration failure' })
    const delay = vi.fn(async () => undefined)
    const embed = vi.fn(async () => {
      throw new Error('Session attachment embedding model is not configured')
    })
    const controller = new MobileSessionAttachmentRagController(storage, {
      embed,
      rerank: vi.fn(),
      delay,
    })
    const created = await controller.create({
      sessionId: 'session-config',
      messageId: 'message-config',
      attachmentStorageKey: 'parsed',
      filename: 'config.txt',
      mimeType: 'text/plain',
      fileSize: 21,
      tokenEstimate: 6,
    })

    const failed = await waitUntilReady(controller, created.id)
    expect(failed.status).toBe('failed')
    expect(failed.resumable).toBe(false)
    expect(embed).toHaveBeenCalledOnce()
    expect(delay).not.toHaveBeenCalled()
  })
})
