import { getDefaultInterfaceColors } from '../../theme-colors'
import { DEFAULT_ENABLED_BUILTIN_SKILL_NAMES } from '../../types/skills'
import { type DocumentParserConfig, type Settings, Theme } from './settings-schema'

export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'

export interface SettingsHostDefaults {
  isDesktopLike: boolean
}

export function getDefaultDocumentParser(host: SettingsHostDefaults): DocumentParserConfig {
  return host.isDesktopLike ? { type: 'local' } : { type: 'chatbox-ai' }
}

/**
 * Returns the exact historical initial snapshot without importing the broader
 * defaults module (which also initializes UUID/provider dependencies).
 */
export function createDefaultSettings(): Settings {
  return {
    showWordCount: false,
    showTokenCount: false,
    showTokenUsed: true,
    showModelName: true,
    showMessageTimestamp: false,
    showFirstTokenLatency: false,
    showAvatar: true,
    hideSystemPromptMessage: false,
    messageLayout: 'bubble',
    autoScrollNewMessagesToTop: false,
    userAvatarKey: '',
    defaultAssistantAvatarKey: '',
    backgroundImageKey: '',
    backgroundImageOpacity: 0.16,
    theme: Theme.System,
    interfaceColors: getDefaultInterfaceColors(),
    interfaceColorPresets: [],
    language: 'en',
    fontSize: 14,
    spellCheck: true,
    defaultPrompt: DEFAULT_SYSTEM_PROMPT,
    defaultWebBrowsing: false,
    defaultReasoningLevel: 'default',
    allowReportingAndTracking: true,
    hasExpiredLicense: false,
    chatboxAIDesktopPromptDismissed: false,
    enableMarkdownRendering: true,
    enableLaTeXRendering: true,
    enableMermaidRendering: true,
    backgroundGenerationEnabled: true,
    interactiveAnimationsEnabled: true,
    injectDefaultMetadata: true,
    autoPreviewArtifacts: false,
    autoCollapseCodeBlock: true,
    pasteLongTextAsAFile: true,
    autoGenerateTitle: true,
    autoCompaction: true,
    compactionThreshold: 0.6,
    pauseOnToolCallLimit: true,
    autoLaunch: false,
    autoUpdate: true,
    betaUpdate: false,
    defaultEmbeddingModel: undefined,
    defaultRerankModel: undefined,
    defaultImageModel: undefined,
    sessionAttachmentProcessingMode: 'auto',
    comfyui: {
      enabled: false,
      endpoint: '',
      username: '',
      password: '',
      workflowName: 'ComfyUI Workflow',
      workflowJson: '',
      inputMapping: {},
      defaultWidth: 1024,
      defaultHeight: 1024,
      timeoutSeconds: 600,
      pollIntervalMs: 1000,
    },
    shortcuts: {
      quickToggle: 'Alt+`',
      inputBoxFocus: 'mod+i',
      inputBoxWebBrowsingMode: 'mod+e',
      newChat: 'mod+n',
      newPictureChat: '',
      sessionListNavNext: 'mod+tab',
      sessionListNavPrev: 'mod+shift+tab',
      sessionListNavTargetIndex: 'mod',
      messageListRefreshContext: 'mod+shift+n',
      dialogOpenSearch: 'mod+k',
      inputBoxSendMessage: 'Enter',
      inputBoxSendMessageWithoutResponse: 'Ctrl+Enter',
      optionNavUp: 'up',
      optionNavDown: 'down',
      optionSelect: 'enter',
    },
    extension: {
      webSearch: {
        provider: 'build-in',
        tavilyApiKey: '',
        bochaApiKey: '',
        queritApiKey: '',
        queritMaxResults: 5,
        queritTimeRange: 'none',
        searxngBaseUrl: '',
        searxngAuthType: 'none',
        searxngUsername: '',
        searxngPassword: '',
        searxngBearerToken: '',
        searxngMaxResults: 10,
        searxngSafeSearch: 1,
        webpageReader: 'native',
        firecrawlEndpoint: '',
        firecrawlBearerToken: '',
        firecrawlTimeoutSeconds: 60,
        firecrawlFallbackToNative: false,
      },
      knowledgeBase: {
        models: {
          embedding: undefined,
          rerank: undefined,
        },
      },
      // Kept unset until an older persisted snapshot is migrated.
      documentParser: undefined,
    },
    mcp: {
      servers: [],
      enabledBuiltinServers: [],
    },
    skills: {
      enabledSkillNames: [...DEFAULT_ENABLED_BUILTIN_SKILL_NAMES],
      translationEnabled: true,
      builtinDefaultsInitialized: true,
      appliedDefaultBuiltinSkillNames: [...DEFAULT_ENABLED_BUILTIN_SKILL_NAMES],
      mobileKnownSkillNames: [],
    },
    networkTools: {
      enabled: true,
      sshReadOnlyAutoApproval: true,
      maxLanScanHosts: 256,
      speedTestMaxBytes: 25_000_000,
      speedTestDownloadUrl: 'https://speed.cloudflare.com/__down',
      speedTestUploadUrl: 'https://speed.cloudflare.com/__up',
      sshProfiles: [],
      snmpProfiles: [],
    },
  }
}
