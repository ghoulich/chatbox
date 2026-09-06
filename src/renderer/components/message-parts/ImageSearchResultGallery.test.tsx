// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })),
})

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const openLinkMock = vi.fn()
vi.mock('@/platform', () => ({ default: { openLink: (...args: unknown[]) => openLinkMock(...args) } }))
vi.mock('@/components/ImageViewer', () => ({
  ImageViewer: ({ children }: { children: ReactNode }) => <>{children}</>,
  ImageViewerItem: ({ children }: { children: (props: { ref: null; open: () => void }) => ReactNode }) =>
    children({ ref: null, open: vi.fn() }),
}))

import {
  collectImageSearchResults,
  extractImageSearchResults,
  ImageSearchResultGallery,
  selectUnreferencedImageSearchResults,
} from './ImageSearchResultGallery'

const result = {
  title: 'Northern lights',
  imageUrl: 'https://images.example.com/full.jpg',
  thumbnailUrl: 'https://images.example.com/thumb.jpg',
  sourceUrl: 'https://source.example.com/page',
  source: 'Example',
  resolution: '1920 x 1080',
}

function renderGallery() {
  return render(
    <MantineProvider>
      <ImageSearchResultGallery results={[result]} />
    </MantineProvider>
  )
}

afterEach(() => {
  cleanup()
  openLinkMock.mockReset()
})

describe('ImageSearchResultGallery', () => {
  it('filters malformed or unsafe results', () => {
    expect(
      extractImageSearchResults({ imageResults: [result, { ...result, imageUrl: 'javascript:alert(1)' }, null] })
    ).toEqual([result])
  })

  it('collects and deduplicates image results from tool calls for inline final-answer rendering', () => {
    expect(
      collectImageSearchResults([
        { type: 'reasoning', result: { imageResults: [result] } },
        { type: 'tool-call', toolName: 'image_search', result: { imageResults: [result] } },
        { type: 'tool-call', toolName: 'image_search', result: { imageResults: [result] } },
      ])
    ).toEqual([result])
  })

  it('selects image results omitted or rewritten by the model for the fallback gallery', () => {
    const omitted = { ...result, imageUrl: 'https://images.example.com/other.jpg' }
    expect(selectUnreferencedImageSearchResults([result, omitted], `Shown: ${result.imageUrl}`)).toEqual([omitted])
    expect(selectUnreferencedImageSearchResults([result], `Shown: ${result.thumbnailUrl}`)).toEqual([])
  })

  it('renders a thumbnail, metadata, and source action', () => {
    renderGallery()
    expect(screen.getByRole('img', { name: 'Northern lights' }).getAttribute('src')).toBe(result.thumbnailUrl)
    expect(screen.getByText('Example · 1920 x 1080')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Open source/ }))
    expect(openLinkMock).toHaveBeenCalledWith(result.sourceUrl)
  })

  it('falls back from thumbnail to original image, then shows a source card for an unavailable result', () => {
    renderGallery()
    const thumbnail = screen.getByRole('img', { name: 'Northern lights' })
    fireEvent.error(thumbnail)
    const original = screen.getByRole('img', { name: 'Northern lights' })
    expect(original.getAttribute('src')).toBe(result.imageUrl)
    fireEvent.error(original)
    expect(screen.queryByRole('img', { name: 'Northern lights' })).toBeNull()
    expect(screen.getByText('Image unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Open source/ }))
    expect(openLinkMock).toHaveBeenCalledWith(result.sourceUrl)
  })
})
