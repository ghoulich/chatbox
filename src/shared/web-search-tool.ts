import { jsonSchema, type ToolSet } from 'ai'

// The web_search tool definition shared between the renderer
// (packages/model-calls/toolsets/web-search.ts) and the native app. Only the
// executor differs per platform; description, schema, and result shape must
// stay identical so the model behaves the same everywhere.

export const WEB_SEARCH_TOOLSET_INSTRUCTION = `
Use web_search to search the web when doing so would genuinely improve your answer.

## web_search
Search the web when the question benefits from fresh, real-time, or source-specific information — e.g. current events, recent releases, live data, or facts you aren't confident about. For questions you can already answer well from your own knowledge, answer directly. Use short, concise queries (English preferred). When a loaded search skill specifies a SearXNG engine whitelist, pass it through the engines array exactly as instructed.
`

export interface WebSearchToolResult {
  query?: string
  engines?: string[]
  searchResults: Array<{ title: string; snippet: string; link: string }>
}

const SEARCH_ENGINE_RE = /^[A-Za-z0-9][A-Za-z0-9 _.+-]{0,63}$/

export function normalizeSearchEngines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const engines: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const engine = item.trim()
    const identity = engine.toLowerCase()
    if (!SEARCH_ENGINE_RE.test(engine) || seen.has(identity)) continue
    seen.add(identity)
    engines.push(engine)
    if (engines.length >= 20) break
  }
  return engines
}

function formatWebSearchOutput(output: unknown): string {
  if (!output || typeof output !== 'object' || !('searchResults' in output)) {
    return JSON.stringify(output) ?? String(output)
  }
  const searchResults = (output as WebSearchToolResult).searchResults
  if (!Array.isArray(searchResults) || searchResults.length === 0) return 'No search results found.'
  return searchResults
    .map((result, index) => {
      const parts = [`Result ${index + 1}`, `Title: ${result.title}`]
      if (result.link) parts.push(`URL: ${result.link}`)
      if (result.snippet) parts.push(`Snippet:\n${result.snippet}`)
      return parts.join('\n')
    })
    .join('\n\n')
}

function toWebSearchModelOutput({ output }: { output: unknown }): { type: 'text'; value: string } {
  return {
    type: 'text',
    value: formatWebSearchOutput(output),
  }
}

export function createWebSearchTool(
  executor: (query: string, engines: string[], abortSignal?: AbortSignal) => Promise<WebSearchToolResult>
): ToolSet[string] {
  return {
    description:
      'Search the web for information. Use it when fresh, real-time, or source-specific data would improve the answer (current events, recent releases, live data, facts you are unsure about). For questions you can answer confidently from your own knowledge, answer directly instead. Use short, concise queries (English preferred).',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'the search query' },
        engines: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', minLength: 1, maxLength: 64 },
          description:
            'Optional SearXNG-only engine whitelist. Supply this when a loaded search skill requires specific engines; omit it for the configured default engines.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    }),
    execute: async (input, { abortSignal }) => {
      const searchInput = input as { query: string; engines?: string[] }
      return await executor(searchInput.query, normalizeSearchEngines(searchInput.engines), abortSignal)
    },
    toModelOutput: toWebSearchModelOutput,
  }
}
