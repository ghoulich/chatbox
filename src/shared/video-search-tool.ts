import { jsonSchema, type ToolSet } from 'ai'
import { normalizeSearchEngines } from './web-search-tool'

export const VIDEO_SEARCH_TOOLSET_INSTRUCTION = `
## video_search
Use video_search when the user asks to find, show, locate, or recommend videos from the web. In the final answer, copy each chosen result's Video URL exactly, without rewriting identifiers, changing http/https, or substituting another URL. Place it where its thumbnail belongs, preferably as a standalone URL on its own line. The app replaces matching URLs with inline video cards and falls back to a result gallery if exact placement is not possible. Each result states whether it can play inside Chatbox or requires opening its webpage; separate these two groups clearly and never claim that a webpage-only result plays in the app. Set playback=in_app when the user asks for only directly playable results; otherwise use playback=any. When a loaded search skill specifies a SearXNG engine whitelist, pass it through the engines array exactly as instructed. Never invent a video, thumbnail, or playback URL.
`

export type VideoPlaybackMode = 'iframe' | 'video' | 'webpage'
export type VideoPlaybackFilter = 'any' | 'in_app'

export interface VideoSearchResultItem {
  title: string
  url: string
  thumbnailUrl: string
  playbackUrl: string
  playbackMode: VideoPlaybackMode
  source: string
  author: string
  duration: string
  publishedDate: string
}

export interface VideoSearchToolResult {
  query: string
  playback: VideoPlaybackFilter
  engines?: string[]
  videoResults: VideoSearchResultItem[]
}

function formatVideoSearchOutput(output: unknown): string {
  if (!output || typeof output !== 'object' || !('videoResults' in output)) {
    return JSON.stringify(output) ?? String(output)
  }
  const result = output as VideoSearchToolResult
  if (!Array.isArray(result.videoResults) || result.videoResults.length === 0) {
    return result.playback === 'in_app' ? 'No videos playable inside Chatbox were found.' : 'No video results found.'
  }
  return result.videoResults
    .map((item, index) => {
      const parts = [
        `Video ${index + 1}`,
        `Title: ${item.title}`,
        `Video URL: ${item.url}`,
        `Playback: ${item.playbackMode === 'webpage' ? 'Webpage only' : 'Playable inside Chatbox'}`,
      ]
      if (item.thumbnailUrl) parts.push(`Thumbnail URL: ${item.thumbnailUrl}`)
      if (item.playbackUrl) parts.push(`Playback URL: ${item.playbackUrl}`)
      if (item.source) parts.push(`Source: ${item.source}`)
      if (item.author) parts.push(`Author: ${item.author}`)
      if (item.duration) parts.push(`Duration: ${item.duration}`)
      if (item.publishedDate) parts.push(`Published: ${item.publishedDate}`)
      return parts.join('\n')
    })
    .join('\n\n')
}

function toVideoSearchModelOutput({ output }: { output: unknown }): { type: 'text'; value: string } {
  return { type: 'text', value: formatVideoSearchOutput(output) }
}

export function createVideoSearchTool(
  executor: (
    query: string,
    playback: VideoPlaybackFilter,
    engines: string[],
    abortSignal?: AbortSignal
  ) => Promise<VideoSearchToolResult>
): ToolSet[string] {
  return {
    description:
      'Search the web for videos. Results identify in-app playback versus webpage-only playback. Supports filtering to only videos playable inside Chatbox.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'a short, specific video search query' },
        playback: {
          type: 'string',
          enum: ['any', 'in_app'],
          default: 'any',
          description: 'Use in_app only when the user requests videos that play directly inside Chatbox.',
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
      const searchInput = input as { query: string; playback?: VideoPlaybackFilter; engines?: string[] }
      return await executor(
        searchInput.query,
        searchInput.playback ?? 'any',
        normalizeSearchEngines(searchInput.engines),
        abortSignal
      )
    },
    toModelOutput: toVideoSearchModelOutput,
  }
}
