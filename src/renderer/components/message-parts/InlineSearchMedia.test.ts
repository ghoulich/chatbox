import type { VideoSearchResultItem } from '@shared/video-search-tool'
import { describe, expect, test } from 'vitest'
import { selectUnreferencedVideoSearchResults } from './InlineSearchMedia'

function video(url: string): VideoSearchResultItem {
  return {
    title: url,
    url,
    thumbnailUrl: 'https://example.com/thumb.jpg',
    playbackUrl: '',
    playbackMode: 'webpage',
    source: '',
    author: '',
    duration: '',
    publishedDate: '',
  }
}

describe('selectUnreferencedVideoSearchResults', () => {
  test('falls back to cards when the model rewrites a result URL', () => {
    const exact = video('http://example.com/video/123')
    const rewritten = video('http://example.com/video/456')

    expect(
      selectUnreferencedVideoSearchResults(
        [exact, rewritten],
        'Exact result: http://example.com/video/123\nRewritten result: https://example.com/watch/456'
      )
    ).toEqual([rewritten])
  })
})
