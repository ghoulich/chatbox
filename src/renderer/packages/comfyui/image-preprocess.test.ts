import { describe, expect, it } from 'vitest'
import { calculateComfyUIReferenceSize, estimateDataUrlBytes } from './image-preprocess'

describe('ComfyUI mobile reference preprocessing', () => {
  it('keeps small images unchanged', () => {
    expect(calculateComfyUIReferenceSize(1024, 768)).toEqual({ width: 1024, height: 768 })
  })

  it('bounds both dimensions and total pixels while preserving aspect ratio', () => {
    const landscape = calculateComfyUIReferenceSize(8000, 4000)
    expect(landscape.width).toBeLessThanOrEqual(2048)
    expect(landscape.height).toBeLessThanOrEqual(2048)
    expect(landscape.width * landscape.height).toBeLessThanOrEqual(3_145_728)
    expect(landscape.width / landscape.height).toBeCloseTo(2, 2)
  })

  it('rejects invalid image dimensions', () => {
    expect(() => calculateComfyUIReferenceSize(0, 100)).toThrow('invalid dimensions')
  })

  it('estimates base64 and percent-encoded data URL byte lengths', () => {
    expect(estimateDataUrlBytes('data:image/png;base64,QUJDRA==')).toBe(4)
    expect(estimateDataUrlBytes('data:text/plain,hello%20world')).toBe(11)
  })
})
