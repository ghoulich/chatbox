import type { ComfyUIReferenceProcessing } from '@shared/types'

export const COMFYUI_MOBILE_MAX_SOURCE_BYTES = 40 * 1024 * 1024
export const COMFYUI_MOBILE_MAX_DIMENSION = 2048
export const COMFYUI_MOBILE_MAX_PIXELS = 3_145_728

export function calculateComfyUIReferenceSize(
  originalWidth: number,
  originalHeight: number,
  maxDimension = COMFYUI_MOBILE_MAX_DIMENSION,
  maxPixels = COMFYUI_MOBILE_MAX_PIXELS
): { width: number; height: number } {
  if (
    !Number.isFinite(originalWidth) ||
    !Number.isFinite(originalHeight) ||
    originalWidth <= 0 ||
    originalHeight <= 0
  ) {
    throw new Error('Image has invalid dimensions')
  }
  const dimensionScale = Math.min(1, maxDimension / originalWidth, maxDimension / originalHeight)
  const pixelScale = Math.min(1, Math.sqrt(maxPixels / (originalWidth * originalHeight)))
  const scale = Math.min(dimensionScale, pixelScale)
  return {
    width: Math.max(1, Math.floor(originalWidth * scale)),
    height: Math.max(1, Math.floor(originalHeight * scale)),
  }
}

export function estimateDataUrlBytes(dataUrl: string): number {
  const separator = dataUrl.indexOf(',')
  if (separator < 0) return 0
  const header = dataUrl.slice(0, separator)
  const payload = dataUrl.slice(separator + 1)
  if (!header.includes(';base64')) return new TextEncoder().encode(decodeURIComponent(payload)).byteLength
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

export interface PreparedComfyUIReference {
  dataUrl: string
  processing: ComfyUIReferenceProcessing
}

export async function prepareComfyUIMobileReference(file: File): Promise<PreparedComfyUIReference> {
  if (!file.type.startsWith('image/')) throw new Error('The selected file is not an image')
  if (file.size > COMFYUI_MOBILE_MAX_SOURCE_BYTES) throw new Error('The reference image is larger than 40 MiB')

  return new Promise<PreparedComfyUIReference>((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      try {
        const size = calculateComfyUIReferenceSize(
          image.naturalWidth || image.width,
          image.naturalHeight || image.height
        )
        const canvas = document.createElement('canvas')
        canvas.width = size.width
        canvas.height = size.height
        const context = canvas.getContext('2d', { alpha: true })
        if (!context) throw new Error('Unable to prepare the reference image')
        context.drawImage(image, 0, 0, size.width, size.height)

        let dataUrl = canvas.toDataURL('image/webp', 0.88)
        let mimeType = 'image/webp'
        if (!dataUrl.startsWith('data:image/webp')) {
          mimeType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
          dataUrl = canvas.toDataURL(mimeType, mimeType === 'image/jpeg' ? 0.88 : undefined)
        }
        resolve({
          dataUrl,
          processing: {
            originalBytes: file.size,
            processedBytes: estimateDataUrlBytes(dataUrl),
            originalWidth: image.naturalWidth || image.width,
            originalHeight: image.naturalHeight || image.height,
            width: size.width,
            height: size.height,
            mimeType,
            resized: size.width !== image.naturalWidth || size.height !== image.naturalHeight || mimeType !== file.type,
          },
        })
      } catch (error) {
        reject(error)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Unable to decode the reference image'))
    }
    image.src = objectUrl
  })
}
