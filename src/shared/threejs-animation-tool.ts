import { jsonSchema, type ToolSet } from 'ai'

export const THREEJS_ANIMATION_ORIGIN = 'https://animation.chatbox.local'

export interface ThreeJsAnimationResult {
  animationId: string
  title: string
  description: string
  code: string
  height: number
  url: string
}

export interface VisualizationDisplayContext {
  viewportWidth: number
  viewportHeight: number
  orientation: 'portrait' | 'landscape' | 'square'
  input: 'touch' | 'pointer'
  devicePixelRatio: number
}

export function buildVisualizationDisplayInstruction(context?: VisualizationDisplayContext): string {
  const measured = context
    ? `Chatbox measured the current visual viewport as ${context.viewportWidth} × ${context.viewportHeight} CSS pixels, ${context.orientation}, with ${context.input} input and device-pixel ratio ${context.devicePixelRatio}.`
    : 'The current viewport could not be measured. Assume a responsive, touch-capable narrow display and avoid fixed-size layouts.'
  return `
## Current visualization display
${measured} This is a generation-time snapshot and can change after rotation, keyboard visibility, split-screen, or fullscreen transitions.

- Make every Mermaid and Three.js visualization responsive. Never assume a desktop-sized canvas.
- For a narrow or portrait viewport, prefer top-to-bottom Mermaid flow, short wrapped labels, fewer sibling nodes, and touch-first controls. For a wide landscape viewport, left-to-right flow is acceptable when it materially improves clarity.
- Three.js code must obtain its live dimensions from api.getViewport() and may subscribe with api.onResize(callback). Keep the important scene content centered and leave room for controls. Controls must wrap or collapse on small screens, stay inside the frame, and have touch targets of at least 44 CSS pixels when touch input is reported.
- The tool's height controls only the inline card. Fullscreen always uses the live available viewport, so update camera, layout, and overlays through api.onResize rather than hard-coded screen dimensions.
`
}

export const MERMAID_DIAGRAM_INSTRUCTION = `
## Static diagrams
Use a fenced \`\`\`mermaid code block for static architecture diagrams, flowcharts, sequence diagrams, state diagrams, entity-relationship diagrams, class diagrams, timelines, and mind maps. Chatbox renders Mermaid directly in the conversation.

When the user explicitly asks you to draw, generate, show, or visualize one of these static diagrams, you MUST include at least one valid fenced \`\`\`mermaid code block in the answer. Mermaid is Markdown output, not a tool call. Do not substitute ASCII art, Unicode box-drawing characters, an indented text diagram, a Markdown table/list, or a prose-only description unless the user explicitly asks for a text/ASCII representation.

Do not call create_threejs_animation for a static diagram merely because the user says “draw”, “visualize”, “architecture”, “flowchart”, or “mind map”. Use create_threejs_animation only when the user explicitly asks for animation, interaction, simulation, or a genuinely three-dimensional presentation.
`

export const THREEJS_ANIMATION_TOOLSET_INSTRUCTION = `
## create_threejs_animation
Use create_threejs_animation only when the user explicitly asks for an interactive animation, simulation, animated scientific demonstration, 3D explanation, or dynamic visualization. The animation is rendered locally inside Chatbox with the bundled Three.js runtime. Never use this tool for a static architecture diagram, flowchart, sequence diagram, state diagram, entity-relationship diagram, class diagram, timeline, or mind map; render those with Mermaid instead.

The code is a JavaScript function body executed inside an isolated animation frame. It receives two arguments: THREE and api. Use api.scene, api.camera, api.renderer, api.overlay, api.onFrame(callback), api.onResize(callback), api.getViewport(), api.onCleanup(callback), api.enableOrbitControls(target), api.renderFormula(target, latex, options), and api.setStatus(text). api.onFrame invokes callback with exactly one object: { time, delta, elapsed }; delta and elapsed are seconds. Always write api.onFrame(({ delta, elapsed }) => { ... }) rather than treating the first argument as a number. Every object that is supposed to move and every live readout must be updated from this callback, and all initial positions must remain finite numbers. The frame's sandboxed document is available for document.createElement and canvas drawing. Prefer api.onFrame for animation. For compatibility, bare requestAnimationFrame/cancelAnimationFrame and timer functions are managed by Chatbox, bounded, paused with the animation, and cleaned up automatically. Do not access those schedulers through window/globalThis/self. Do not access parent, top, opener, or another frame; import libraries; access the network; or create workers. Add responsive explanatory controls and live values to api.overlay using ordinary DOM elements.

Render every visible mathematical formula with the bundled offline KaTeX helper. First append a dedicated target element inside api.overlay, then call api.renderFormula(target, String.raw\`E = E_k + E_p\`, { displayMode: false }). Use standard LaTeX for indices, powers, fractions, roots, sums, integrals, limits, vectors, matrices, Greek letters, and units. Set displayMode to true only for a standalone equation. Do not implement formula layout manually, use Unicode modifier-letter substitutes such as ᵏ or ᵖ, display ASCII underscore notation, draw formulas with canvas fillText, import KaTeX, or fetch fonts. api.renderFormula is offline, uses packaged fonts, accepts at most 4,000 LaTeX characters per formula and 64 formulas per animation, and keeps trust disabled.

After the tool returns, place the exact Animation URL from the result in the final answer at the position where the animation belongs, preferably as a standalone Markdown link. Chatbox replaces it with the live inline animation. Never invent an animation URL.
`

const forbiddenRawSourcePatterns: Array<[RegExp, string]> = [[/<\/?script\b/i, 'script tags']]

const forbiddenExecutablePatterns: Array<[RegExp, string]> = [
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|importScripts)\b/, 'network or worker APIs'],
  [/\b(?:localStorage|sessionStorage|indexedDB)\b/, 'persistent browser storage'],
  [/\b(?:eval|Function)\s*\(/, 'dynamic code evaluation'],
  [/\bimport\s*\(/, 'dynamic imports'],
  [
    /\b(?:window|globalThis|self)\s*(?:\.\s*(?:requestAnimationFrame|cancelAnimationFrame|setTimeout|clearTimeout|setInterval|clearInterval)|\[\s*(['"])(?:requestAnimationFrame|cancelAnimationFrame|setTimeout|clearTimeout|setInterval|clearInterval)\1\s*\])/,
    'unmanaged browser scheduling',
  ],
  [/\bwhile\s*\(\s*(?:true|1|!\s*0)\s*\)/, 'unbounded while loops'],
]

const parentFramePatterns = [
  /(?<![\w$.])(?:parent|top|opener)\b/,
  /\b(?:window|globalThis|self)\s*\.\s*(?:parent|top|opener)\b/,
  /\b(?:window|globalThis|self)\s*\[\s*(['"])(?:parent|top|opener)\1\s*\]/,
]

// Generated animation code often contains CSS declarations such as `top: 12px`
// and geometry reads such as `rect.top`. Neither accesses the parent frame. Mask
// quoted strings and comments, then reject only free global identifiers; member
// properties are deliberately excluded by the negative lookbehind above.
function maskQuotedStringsAndComments(source: string): string {
  const output = source.split('')
  let index = 0

  const maskCharacter = () => {
    output[index] = source[index] === '\n' ? '\n' : ' '
    index += 1
  }

  const maskEscapedCharacter = () => {
    maskCharacter()
    if (index < source.length) maskCharacter()
  }

  const maskQuotedString = (quote: "'" | '"') => {
    maskCharacter()
    while (index < source.length) {
      const character = source[index]
      if (character === '\\') {
        maskEscapedCharacter()
        continue
      }
      maskCharacter()
      if (character === quote) break
    }
  }

  const maskLineComment = () => {
    maskCharacter()
    maskCharacter()
    while (index < source.length && source[index] !== '\n') maskCharacter()
  }

  const maskBlockComment = () => {
    maskCharacter()
    maskCharacter()
    while (index < source.length) {
      if (source[index] === '*' && source[index + 1] === '/') {
        maskCharacter()
        maskCharacter()
        break
      }
      maskCharacter()
    }
  }

  const maskTemplateLiteral = () => {
    maskCharacter()
    while (index < source.length) {
      const current = source[index]
      const next = source[index + 1]
      if (current === '\\') {
        maskEscapedCharacter()
        continue
      }
      if (current === '`') {
        maskCharacter()
        break
      }
      if (current === '$' && next === '{') {
        maskCharacter()
        maskCharacter()
        let braceDepth = 1
        while (index < source.length && braceDepth > 0) {
          const expressionCharacter = source[index]
          const expressionNext = source[index + 1]
          if (expressionCharacter === "'" || expressionCharacter === '"') {
            maskQuotedString(expressionCharacter)
            continue
          }
          if (expressionCharacter === '`') {
            maskTemplateLiteral()
            continue
          }
          if (expressionCharacter === '/' && expressionNext === '/') {
            maskLineComment()
            continue
          }
          if (expressionCharacter === '/' && expressionNext === '*') {
            maskBlockComment()
            continue
          }
          if (expressionCharacter === '{') braceDepth += 1
          if (expressionCharacter === '}') braceDepth -= 1
          index += 1
        }
        continue
      }
      maskCharacter()
    }
  }

  while (index < source.length) {
    const current = source[index]
    const next = source[index + 1]
    if (current === "'" || current === '"') {
      maskQuotedString(current)
      continue
    }
    if (current === '`') {
      maskTemplateLiteral()
      continue
    }
    if (current === '/' && next === '/') {
      maskLineComment()
      continue
    }
    if (current === '/' && next === '*') {
      maskBlockComment()
      continue
    }
    index += 1
  }
  return output.join('')
}

export function validateThreeJsAnimationCode(code: string): string | undefined {
  if (!code.trim()) return 'Animation code is empty.'
  if (code.length > 60_000) return 'Animation code exceeds the 60,000 character limit.'
  for (const [pattern, label] of forbiddenRawSourcePatterns) {
    if (pattern.test(code)) return `Animation code cannot use ${label}.`
  }
  const executableSource = maskQuotedStringsAndComments(code)
  for (const [pattern, label] of forbiddenExecutablePatterns) {
    if (pattern.test(executableSource)) return `Animation code cannot use ${label}.`
  }
  if (
    parentFramePatterns[0].test(executableSource) ||
    parentFramePatterns[1].test(executableSource) ||
    parentFramePatterns[2].test(code)
  ) {
    return 'Animation code cannot use parent-frame access.'
  }
  return undefined
}

export function getThreeJsAnimationUrl(animationId: string): string {
  return `${THREEJS_ANIMATION_ORIGIN}/${encodeURIComponent(animationId)}`
}

function toModelOutput({ output }: { output: unknown }): { type: 'text'; value: string } {
  if (!output || typeof output !== 'object') {
    return { type: 'text', value: JSON.stringify(output) ?? String(output) }
  }
  const result = output as Partial<ThreeJsAnimationResult> & { error?: string }
  if (result.error) return { type: 'text', value: `Animation error: ${result.error}` }
  return {
    type: 'text',
    value: [
      'Interactive animation created.',
      `Title: ${result.title || 'Untitled animation'}`,
      `Animation URL: ${result.url || ''}`,
      'Place this exact Animation URL in the final answer where the live animation should appear.',
    ].join('\n'),
  }
}

export function createThreeJsAnimationTool(): ToolSet[string] {
  return {
    description:
      'Create a local, sandboxed Three.js animation only for explicitly animated, interactive, simulated, or 3D requests. Never use it for static architecture diagrams, flowcharts, or mind maps; use Mermaid for those.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 120 },
        description: {
          type: 'string',
          maxLength: 500,
          description: 'A concise description shown above the animation and used as an accessible label.',
        },
        code: {
          type: 'string',
          minLength: 1,
          maxLength: 60_000,
          description:
            'JavaScript function body using the provided THREE and api arguments. Register updates with api.onFrame and render visible formulas with api.renderFormula.',
        },
        height: {
          type: 'integer',
          minimum: 220,
          maximum: 640,
          default: 360,
          description:
            'Inline animation height in CSS pixels. Choose it for the current display context; fullscreen ignores this value and fills the live viewport.',
        },
      },
      required: ['title', 'code'],
      additionalProperties: false,
    }),
    execute: (input, { toolCallId }) => {
      const value = input as { title: string; description?: string; code: string; height?: number }
      const error = validateThreeJsAnimationCode(value.code)
      if (error) return { error }
      const animationId = toolCallId || `animation-${Date.now()}`
      return {
        animationId,
        title: value.title.trim().slice(0, 120),
        description: (value.description || '').trim().slice(0, 500),
        code: value.code,
        height: Math.min(640, Math.max(220, value.height ?? 360)),
        url: getThreeJsAnimationUrl(animationId),
      } satisfies ThreeJsAnimationResult
    },
    toModelOutput,
  }
}
