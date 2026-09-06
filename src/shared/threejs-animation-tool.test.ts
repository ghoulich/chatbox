import { describe, expect, it } from 'vitest'
import {
  buildVisualizationDisplayInstruction,
  createThreeJsAnimationTool,
  getThreeJsAnimationUrl,
  MERMAID_DIAGRAM_INSTRUCTION,
  THREEJS_ANIMATION_TOOLSET_INSTRUCTION,
  validateThreeJsAnimationCode,
} from './threejs-animation-tool'

describe('threejs animation tool', () => {
  it('accepts a bounded scene with an api-managed frame callback', () => {
    expect(
      validateThreeJsAnimationCode(`
        const ball = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial())
        api.scene.add(ball)
        api.onFrame(({ elapsed }) => { ball.position.y = Math.sin(elapsed) })
      `)
    ).toBeUndefined()
  })

  it.each([
    'fetch("https://example.com")',
    'window.setInterval(() => {}, 10)',
    'while (true) {}',
    'parent.postMessage(1)',
  ])('rejects unsafe source: %s', (code) => expect(validateThreeJsAnimationCode(code)).toMatch(/cannot use/))

  it('accepts bounded loops and Chatbox-managed animation frames and timers', () => {
    expect(
      validateThreeJsAnimationCode(`
        let remaining = 3
        while (remaining > 0) remaining -= 1
        const frame = requestAnimationFrame(() => api.setStatus('ready'))
        const timer = setTimeout(() => cancelAnimationFrame(frame), 20)
        api.onCleanup(() => clearTimeout(timer))
      `)
    ).toBeUndefined()
  })

  it('allows sandboxed document use, CSS top declarations, and ordinary top properties', () => {
    expect(
      validateThreeJsAnimationCode(`
        const label = document.createElement('div')
        label.style.cssText = 'position:absolute;top:12px'
        const bounds = api.renderer.domElement.getBoundingClientRect()
        const pointerY = bounds.top + 10
        api.overlay.appendChild(label)
      `)
    ).toBeUndefined()
  })

  it('allows CSS top declarations inside template literals without hiding executable interpolation', () => {
    expect(
      validateThreeJsAnimationCode(`
        const style = document.createElement('style')
        style.textContent = \`#panel { position: absolute; top: 12px; }\`
        api.overlay.appendChild(style)
      `)
    ).toBeUndefined()
    expect(validateThreeJsAnimationCode('const value = `unsafe: ${top.location.href}`')).toBe(
      'Animation code cannot use parent-frame access.'
    )
  })

  it('does not reject API names that only appear inside formula or explanation strings', () => {
    expect(
      validateThreeJsAnimationCode(`
        const formula = String.raw\`\\operatorname{Function}(x) = x^2\`
        const note = 'The browser must not fetch external fonts.'
        const target = document.createElement('div')
        api.overlay.appendChild(target)
        api.renderFormula(target, formula)
      `)
    ).toBeUndefined()
  })

  it.each(['top.location.href', 'window.parent.postMessage(1)', "globalThis['opener']"])(
    'still rejects real parent-frame access: %s',
    (code) => expect(validateThreeJsAnimationCode(code)).toBe('Animation code cannot use parent-frame access.')
  )

  it('routes static diagrams to Mermaid and limits the animation tool to dynamic requests', () => {
    expect(MERMAID_DIAGRAM_INSTRUCTION).toContain('```mermaid')
    expect(MERMAID_DIAGRAM_INSTRUCTION).toContain('static architecture diagrams')
    expect(MERMAID_DIAGRAM_INSTRUCTION).toContain('MUST include at least one valid fenced')
    expect(MERMAID_DIAGRAM_INSTRUCTION).toContain('Do not substitute ASCII art')
    expect(MERMAID_DIAGRAM_INSTRUCTION).toContain('Mermaid is Markdown output, not a tool call')
    expect(THREEJS_ANIMATION_TOOLSET_INSTRUCTION).toContain('Never use this tool for a static architecture diagram')
    expect(THREEJS_ANIMATION_TOOLSET_INSTRUCTION).toContain('{ time, delta, elapsed }')
    expect(THREEJS_ANIMATION_TOOLSET_INSTRUCTION).toContain('api.renderFormula(target, latex, options)')
    expect(THREEJS_ANIMATION_TOOLSET_INSTRUCTION).toContain('bundled offline KaTeX helper')
    expect(THREEJS_ANIMATION_TOOLSET_INSTRUCTION).toContain('String.raw`E = E_k + E_p`')
    expect(THREEJS_ANIMATION_TOOLSET_INSTRUCTION).toContain('keeps trust disabled')
    expect(createThreeJsAnimationTool().description).toContain('Never use it for static architecture diagrams')
    expect(createThreeJsAnimationTool().inputSchema).toBeTruthy()
  })

  it('describes the measured display and responsive touch behavior to the model', () => {
    const instruction = buildVisualizationDisplayInstruction({
      viewportWidth: 390,
      viewportHeight: 844,
      orientation: 'portrait',
      input: 'touch',
      devicePixelRatio: 3,
    })
    expect(instruction).toContain('390 × 844 CSS pixels, portrait, with touch input')
    expect(instruction).toContain('api.getViewport()')
    expect(instruction).toContain('api.onResize(callback)')
    expect(instruction).toContain('44 CSS pixels')
  })

  it('creates a stable local marker URL', () => {
    expect(getThreeJsAnimationUrl('tool 1')).toBe('https://animation.chatbox.local/tool%201')
  })
})
