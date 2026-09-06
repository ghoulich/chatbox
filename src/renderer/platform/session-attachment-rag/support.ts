import type { PlatformType } from '../interfaces'

export function supportsSessionAttachmentRag(platformType: PlatformType): boolean {
  return platformType === 'desktop' || platformType === 'mobile'
}
