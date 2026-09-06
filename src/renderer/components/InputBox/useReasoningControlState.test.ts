// @vitest-environment jsdom

import { ModelProviderEnum, type ProviderInfo } from '@shared/types'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/chatStore', () => ({
  updateSession: vi.fn(),
}))

import { useReasoningControlState } from './useReasoningControlState'

const providers = [
  {
    id: ModelProviderEnum.ChatboxAI,
    models: [
      {
        modelId: 'deepseek-v4-pro',
        apiStyle: 'openai-responses',
        capabilities: ['tool_use'],
      },
    ],
  },
] as ProviderInfo[]

describe('useReasoningControlState new-conversation defaults', () => {
  it('applies and persists the configured default effort for the selected model', () => {
    const { result } = renderHook(() =>
      useReasoningControlState({
        currentSessionId: 'new',
        isNewSession: true,
        model: { provider: ModelProviderEnum.ChatboxAI, modelId: 'deepseek-v4-pro' },
        providers,
        defaultReasoningLevel: 'high',
      })
    )

    const expected = { openai: { reasoningEffort: 'max', forceReasoning: true } }
    expect(result.current.effectiveProviderOptions).toEqual(expected)
    expect(result.current.settingsPatch).toEqual({
      providerOptionsByModel: {
        'chatbox-ai:deepseek-v4-pro': expected,
      },
    })
  })

  it('keeps the provider default when no global effort override is selected', () => {
    const { result } = renderHook(() =>
      useReasoningControlState({
        currentSessionId: 'new',
        isNewSession: true,
        model: { provider: ModelProviderEnum.ChatboxAI, modelId: 'deepseek-v4-pro' },
        providers,
        defaultReasoningLevel: 'default',
      })
    )

    expect(result.current.effectiveProviderOptions).toBeUndefined()
    expect(result.current.settingsPatch).toBeUndefined()
  })
})
