import platform from '@/platform'

export const featureFlags = {
  mcp: platform.type === 'desktop' || platform.type === 'mobile',
  knowledgeBase: platform.isDesktopLike,
  skills: platform.type === 'desktop' || platform.type === 'mobile',
  agentMode: platform.isDesktopLike,
}
