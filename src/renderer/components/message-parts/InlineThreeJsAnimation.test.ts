import type { ThreeJsAnimationResult } from '@shared/threejs-animation-tool'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildInlineKatexStyles,
  collectThreeJsAnimations,
  extractThreeJsAnimation,
  getInlineKatexBundleDiagnostics,
  resolveInlineThreeJsHeight,
  THREE_JS_FULLSCREEN_MODAL_STYLES,
  THREE_JS_FULLSCREEN_SURFACE_STYLE,
} from './InlineThreeJsAnimation'

const animation: ThreeJsAnimationResult = {
  animationId: 'animation-1',
  title: 'Energy conservation',
  description: 'A rolling ball exchanges potential and kinetic energy.',
  code: 'api.onFrame(() => {})',
  height: 360,
  url: 'https://animation.chatbox.local/animation-1',
}

describe('inline Three.js animation results', () => {
  it('accepts a bounded valid tool result', () => {
    expect(extractThreeJsAnimation(animation)).toEqual(animation)
  })

  it('rejects external marker URLs and oversized code', () => {
    expect(extractThreeJsAnimation({ ...animation, url: 'https://example.com/a' })).toBeUndefined()
    expect(extractThreeJsAnimation({ ...animation, code: 'x'.repeat(60_001) })).toBeUndefined()
  })

  it('collects only completed animation tool results and removes duplicates', () => {
    expect(
      collectThreeJsAnimations([
        { type: 'tool-call', toolName: 'create_threejs_animation', result: animation },
        { type: 'tool-call', toolName: 'create_threejs_animation', result: animation },
        { type: 'tool-call', toolName: 'image_search', result: animation },
      ])
    ).toEqual([animation])
  })

  it('lets the fullscreen animation surface fill the modal body instead of keeping the inline iframe height', () => {
    expect(THREE_JS_FULLSCREEN_MODAL_STYLES.content).toMatchObject({
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    })
    expect(THREE_JS_FULLSCREEN_MODAL_STYLES.body).toMatchObject({
      display: 'flex',
      flex: '1 1 auto',
      minHeight: 0,
      padding: 0,
    })
    expect(THREE_JS_FULLSCREEN_SURFACE_STYLE).toMatchObject({
      flex: '1 1 auto',
      minHeight: 0,
      width: '100%',
    })
  })

  it('caps the inline card against the live visual viewport', () => {
    expect(resolveInlineThreeJsHeight(640, 500)).toBe(310)
    expect(resolveInlineThreeJsHeight(360, 900)).toBe(360)
    expect(resolveInlineThreeJsHeight(220, 200)).toBe(180)
  })

  it('includes responsive viewport callbacks and touch orbit gestures in the isolated runner', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/renderer/components/message-parts/InlineThreeJsAnimation.tsx'),
      'utf8'
    )
    expect(source).toContain('getViewport,onFrame')
    expect(source).toContain('onResize(fn)')
    expect(source).toContain("event.pointerType==='touch'")
    expect(source).toContain('pinchDistance/nextDistance')
    expect(source).toContain('[Symbol.toPrimitive](){return delta}')
    expect(source).not.toContain('normalizePortableMathGlyphs')
    expect(source).toContain('safeRequestAnimationFrame')
    expect(source).toContain('safeSetInterval')
  })

  it('bundles offline KaTeX formulas and fonts without relaxing the network sandbox', () => {
    const styles = buildInlineKatexStyles()
    const diagnostics = getInlineKatexBundleDiagnostics()
    expect(diagnostics.runtimeBytes).toBeGreaterThan(200_000)
    expect(diagnostics.styleBytes).toBeGreaterThan(300_000)
    expect(diagnostics.fontCount).toBe(20)
    expect(styles).toContain('font-family:KaTeX_Main')
    expect(styles).toContain('data:font/woff2;base64,')
    expect(styles).not.toContain('url(fonts/')

    const source = readFileSync(
      path.join(process.cwd(), 'src/renderer/components/message-parts/InlineThreeJsAnimation.tsx'),
      'utf8'
    )
    expect(source).toContain('font-src data:')
    expect(source).toContain('function renderFormula(target,latex,options)')
    expect(source).toContain('trust:false')
    expect(source).toContain("strict:'error'")
    expect(source).toContain('maxExpand:1000')
    expect(source).toContain('enableOrbitControls,renderFormula,setStatus')
  })
})
