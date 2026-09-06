import { describe, expect, it } from 'vitest'
import {
  getDefaultVisionAnalysisPrompt,
  getVisionUserQuestionFallback,
  resolveVisionAnalysisPrompt,
  VISION_USER_QUESTION_PLACEHOLDER,
} from './vision-analysis-prompt'

describe('vision analysis prompt', () => {
  it('provides a localized default for every supported language', () => {
    const languages = [
      'ar',
      'de',
      'en',
      'es',
      'fr',
      'it-IT',
      'ja',
      'ko',
      'nb-NO',
      'pt-PT',
      'ru',
      'sv',
      'zh-Hans',
      'zh-Hant',
    ] as const

    for (const language of languages) {
      expect(getDefaultVisionAnalysisPrompt(language)).toContain(VISION_USER_QUESTION_PLACEHOLDER)
      expect(getVisionUserQuestionFallback(language).length).toBeGreaterThan(10)
    }
  })

  it('replaces every placeholder with the question from the image message', () => {
    expect(resolveVisionAnalysisPrompt('Before {{USER_QUESTION}} / {{USER_QUESTION}} after', 'What is shown?')).toBe(
      'Before What is shown? / What is shown? after'
    )
  })

  it('uses the localized fallback when the image message has no text', () => {
    expect(resolveVisionAnalysisPrompt('{{USER_QUESTION}}', '  ', '请完整提取图片信息。')).toBe(
      '请完整提取图片信息。'
    )
  })

  it('uses the English default when a custom prompt is blank', () => {
    expect(resolveVisionAnalysisPrompt('   ', 'Question')).toContain('visual information transcription module')
  })
})
