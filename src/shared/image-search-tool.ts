import { jsonSchema, type ToolSet } from 'ai'
import { normalizeSearchEngines } from './web-search-tool'

export const IMAGE_SEARCH_TOOLSET_INSTRUCTION = `
## image_search
When the user explicitly asks to find, show, locate, compare, or recommend existing images from the web, you MUST call image_search. Do not substitute web_search for an explicit image request. In the final answer, place each chosen result's Image URL exactly where that image belongs, preferably as a standalone URL on its own line. The app replaces matching, accessibility-checked URLs with inline images in the same positions and automatically shows any valid results you omit. In reasoning or intermediate narration, mention raw image URLs instead of embedding images. Set showInReasoning=true only when the user explicitly asks to see images inside the reasoning/process area. Briefly describe useful results and use each result's Source URL when attribution or further context is helpful. When a loaded search skill specifies a SearXNG engine whitelist, pass it through the engines array exactly as instructed. Never invent an image URL.
`

export interface ImageSearchResultItem {
  title: string
  imageUrl: string
  thumbnailUrl: string
  sourceUrl: string
  source: string
  resolution: string
}

export interface ImageSearchToolResult {
  query: string
  engines?: string[]
  imageResults: ImageSearchResultItem[]
}

function formatImageSearchOutput(output: unknown): string {
  if (!output || typeof output !== 'object' || !('imageResults' in output)) {
    return JSON.stringify(output) ?? String(output)
  }
  const imageResults = (output as ImageSearchToolResult).imageResults
  if (!Array.isArray(imageResults) || imageResults.length === 0) return 'No image results found.'
  return imageResults
    .map((result, index) => {
      const parts = [`Image ${index + 1}`, `Title: ${result.title}`, `Image URL: ${result.imageUrl}`]
      if (result.thumbnailUrl && result.thumbnailUrl !== result.imageUrl) {
        parts.push(`Thumbnail URL: ${result.thumbnailUrl}`)
      }
      if (result.sourceUrl) parts.push(`Source URL: ${result.sourceUrl}`)
      if (result.source) parts.push(`Source: ${result.source}`)
      if (result.resolution) parts.push(`Resolution: ${result.resolution}`)
      return parts.join('\n')
    })
    .join('\n\n')
}

function toImageSearchModelOutput({ output }: { output: unknown }): { type: 'text'; value: string } {
  return { type: 'text', value: formatImageSearchOutput(output) }
}

export function createImageSearchTool(
  executor: (query: string, engines: string[], abortSignal?: AbortSignal) => Promise<ImageSearchToolResult>
): ToolSet[string] {
  return {
    description:
      'Search the web for existing images. You must use this tool for explicit image-search requests instead of web_search. Results are accessibility-checked; matching final-answer URLs render as inline images in place and omitted valid results are shown automatically. Keep reasoning to raw URLs and never fabricate image URLs.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'a short, specific image search query' },
        showInReasoning: {
          type: 'boolean',
          default: false,
          description:
            'Show images inside the reasoning/process area. Keep false unless the user explicitly requested reasoning-area images.',
        },
        engines: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', minLength: 1, maxLength: 64 },
          description:
            'Optional SearXNG engine whitelist. Supply it when a loaded search skill requires specific engines.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    }),
    execute: async (input, { abortSignal }) => {
      const searchInput = input as { query: string; engines?: string[] }
      return await executor(searchInput.query, normalizeSearchEngines(searchInput.engines), abortSignal)
    },
    toModelOutput: toImageSearchModelOutput,
  }
}
