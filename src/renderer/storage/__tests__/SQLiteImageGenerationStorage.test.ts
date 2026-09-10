import type { ImageGeneration } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SQLiteImageGenerationStorage } from '../SQLiteImageGenerationStorage'

const mockDatabase = vi.hoisted(() => ({
  open: vi.fn(),
  execute: vi.fn(),
  run: vi.fn(),
  query: vi.fn(),
}))

const mockConnection = vi.hoisted(() => ({
  closeConnection: vi.fn(),
  createConnection: vi.fn(),
}))

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  // biome-ignore lint/complexity/useArrowFunction: SQLiteConnection is constructed with new.
  SQLiteConnection: vi.fn(function () {
    return mockConnection
  }),
}))

const source = {
  type: 'chatbox_cli' as const,
  sessionId: 'session-1',
  toolCallId: 'tool-1',
}

function makeRecord(overrides: Partial<ImageGeneration> = {}): ImageGeneration {
  return {
    id: 'record-1',
    prompt: 'red fox',
    referenceImages: [],
    generatedImages: [],
    createdAt: 1_000,
    model: {
      provider: 'chatbox-ai',
      modelId: 'manifest-image',
    },
    status: 'pending',
    taskId: 'task-1',
    source,
    ...overrides,
  }
}

function makeRow(record: ImageGeneration): Record<string, unknown> {
  return {
    id: record.id,
    prompt: record.prompt,
    reference_images: JSON.stringify(record.referenceImages),
    generated_images: JSON.stringify(record.generatedImages),
    generated_image_thumbnails: null,
    created_at: record.createdAt,
    model_provider: record.model.provider,
    model_id: record.model.modelId,
    dalle_style: null,
    image_generate_num: null,
    status: record.status,
    parent_id: null,
    error: null,
    error_code: null,
    error_item_uuid: null,
    task_id: record.taskId,
    aspect_ratio: null,
    source: JSON.stringify(record.source),
    comfyui_metadata: record.comfyuiMetadata ? JSON.stringify(record.comfyuiMetadata) : null,
    progress: record.progress ? JSON.stringify(record.progress) : null,
  }
}

describe('SQLiteImageGenerationStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConnection.createConnection.mockResolvedValue(mockDatabase)
    mockDatabase.open.mockResolvedValue(undefined)
    mockDatabase.execute.mockResolvedValue({ changes: { changes: 0 } })
    mockDatabase.run.mockResolvedValue({ changes: { changes: 1 } })
    mockDatabase.query.mockResolvedValue({ values: [] })
  })

  it('adds the source column for existing mobile databases', async () => {
    const storage = new SQLiteImageGenerationStorage()

    await storage.initialize()

    expect(mockDatabase.execute).toHaveBeenCalledWith('ALTER TABLE image_generation ADD COLUMN source TEXT')
    expect(mockDatabase.execute).toHaveBeenCalledWith('ALTER TABLE image_generation ADD COLUMN comfyui_metadata TEXT')
    expect(mockDatabase.execute).toHaveBeenCalledWith('ALTER TABLE image_generation ADD COLUMN progress TEXT')
  })

  it('persists and restores the CLI source', async () => {
    const storage = new SQLiteImageGenerationStorage()
    const record = makeRecord()

    await storage.create(record)

    expect(mockDatabase.run).toHaveBeenCalledWith(
      expect.stringContaining('aspect_ratio, source, comfyui_metadata, progress'),
      [
        'record-1',
        'red fox',
        '[]',
        '[]',
        null,
        1_000,
        'chatbox-ai',
        'manifest-image',
        null,
        null,
        'pending',
        null,
        null,
        null,
        null,
        'task-1',
        null,
        JSON.stringify(source),
        null,
        null,
      ]
    )

    mockDatabase.query.mockResolvedValueOnce({ values: [makeRow(record)] })

    await expect(storage.getById(record.id)).resolves.toMatchObject({ source })
  })

  it('preserves the CLI source when updating a record', async () => {
    const storage = new SQLiteImageGenerationStorage()
    const record = makeRecord()
    mockDatabase.query.mockResolvedValueOnce({ values: [makeRow(record)] })

    await expect(storage.update(record.id, { status: 'generating' })).resolves.toMatchObject({
      status: 'generating',
      source,
    })

    expect(mockDatabase.run).toHaveBeenCalledWith(
      expect.stringContaining('aspect_ratio = ?, source = ?, comfyui_metadata = ?, progress = ?'),
      [
        'red fox',
        '[]',
        '[]',
        null,
        1_000,
        'chatbox-ai',
        'manifest-image',
        null,
        null,
        'generating',
        null,
        null,
        null,
        null,
        'task-1',
        null,
        JSON.stringify(source),
        null,
        null,
        'record-1',
      ]
    )
  })

  it('persists and restores ComfyUI metadata and terminal progress', async () => {
    const storage = new SQLiteImageGenerationStorage()
    const comfyuiMetadata: NonNullable<ImageGeneration['comfyuiMetadata']> = {
      workflowId: 'workflow-1',
      workflowName: 'SD 1.5 mobile',
      workflowRevision: 3,
      parameters: { width: 512, height: 512, steps: 20, cfg: 7, seed: 501 },
      submittedAt: 2_000,
    }
    const progress: NonNullable<ImageGeneration['progress']> = {
      stage: 'cancelled',
      percent: 0,
      updatedAt: 3_000,
    }
    const record = makeRecord({ comfyuiMetadata, progress })

    await storage.create(record)

    expect(mockDatabase.run).toHaveBeenCalledWith(
      expect.stringContaining('comfyui_metadata, progress'),
      expect.arrayContaining([JSON.stringify(comfyuiMetadata), JSON.stringify(progress)])
    )

    mockDatabase.query.mockResolvedValueOnce({ values: [makeRow(record)] })
    await expect(storage.getById(record.id)).resolves.toMatchObject({ comfyuiMetadata, progress })
  })
})
