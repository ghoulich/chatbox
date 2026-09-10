import { Modal } from '@mantine/core'
import type { ImageSearchResultItem } from '@shared/image-search-tool'
import type { VideoSearchResultItem } from '@shared/video-search-tool'
import { IconExternalLink, IconPhotoOff, IconPlayerPlayFilled, IconWorld } from '@tabler/icons-react'
import { type FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageViewerItem } from '@/components/ImageViewer'
import platform from '@/platform'

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

export function extractVideoSearchResults(value: unknown): VideoSearchResultItem[] {
  if (!value || typeof value !== 'object') return []
  const items = (value as Record<string, unknown>).videoResults
  if (!Array.isArray(items)) return []
  return items.filter((item): item is VideoSearchResultItem => {
    if (!item || typeof item !== 'object') return false
    const result = item as Record<string, unknown>
    const mode = result.playbackMode
    return (
      typeof result.title === 'string' &&
      isHttpUrl(result.url) &&
      (result.thumbnailUrl === '' || isHttpUrl(result.thumbnailUrl)) &&
      (mode === 'iframe' || mode === 'video' || mode === 'webpage') &&
      (mode === 'webpage' ? result.playbackUrl === '' : isHttpUrl(result.playbackUrl)) &&
      typeof result.source === 'string' &&
      typeof result.author === 'string' &&
      typeof result.duration === 'string' &&
      typeof result.publishedDate === 'string'
    )
  })
}

export function collectVideoSearchResults(
  parts: Array<{ type?: string; toolName?: string; result?: unknown }>
): VideoSearchResultItem[] {
  const seen = new Set<string>()
  const results: VideoSearchResultItem[] = []
  for (const part of parts) {
    if (part.type !== 'tool-call' || part.toolName !== 'video_search') continue
    for (const result of extractVideoSearchResults(part.result)) {
      if (seen.has(result.url)) continue
      seen.add(result.url)
      results.push(result)
    }
  }
  return results
}

export function selectUnreferencedVideoSearchResults(
  results: VideoSearchResultItem[],
  answerText: string,
  limit = 10
): VideoSearchResultItem[] {
  return results.filter((result) => !answerText.includes(result.url)).slice(0, Math.max(0, limit))
}

function parseResolution(resolution: string): { width: number; height: number } {
  const match = resolution.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!match) return { width: 1024, height: 768 }
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? { width, height } : { width: 1024, height: 768 }
}

export const InlineImageSearchResult: FC<{ result: ImageSearchResultItem }> = ({ result }) => {
  const { t } = useTranslation()
  const [displayUrl, setDisplayUrl] = useState(result.imageUrl)
  const [failed, setFailed] = useState(false)
  const size = parseResolution(result.resolution)

  if (failed) {
    return (
      <span className="my-3 flex max-w-2xl items-center gap-3 rounded-lg border border-chatbox-border-primary bg-chatbox-background-secondary p-3">
        <IconPhotoOff size={28} className="shrink-0 text-chatbox-tint-secondary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-chatbox-tint-primary">{result.title}</span>
          <span className="block text-xs text-chatbox-tint-secondary">{t('Image unavailable')}</span>
        </span>
        <a
          href={result.imageUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={result.imageUrl}
          className="shrink-0 text-xs text-chatbox-tint-brand"
          onClick={(event) => {
            event.preventDefault()
            void platform.openLink(result.imageUrl)
          }}
        >
          {t('View Image')}
        </a>
        <button
          type="button"
          className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs text-chatbox-tint-brand"
          onClick={() => void platform.openLink(result.sourceUrl)}
        >
          {t('Open source')}
        </button>
      </span>
    )
  }

  return (
    <span className="my-3 block max-w-2xl">
      <ImageViewerItem
        original={result.imageUrl}
        thumbnail={displayUrl}
        width={size.width}
        height={size.height}
        alt={result.title}
        caption={result.title}
      >
        {({ ref, open }) => (
          <img
            ref={ref}
            src={displayUrl}
            alt={result.title}
            title={result.title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="max-h-[70vh] w-auto max-w-full cursor-zoom-in rounded-lg object-contain"
            onError={() => {
              if (displayUrl !== result.thumbnailUrl && result.thumbnailUrl) {
                setDisplayUrl(result.thumbnailUrl)
              } else {
                setFailed(true)
              }
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              open(event)
            }}
          />
        )}
      </ImageViewerItem>
      {result.title && <span className="mt-1 block text-xs text-chatbox-tint-secondary">{result.title}</span>}
    </span>
  )
}

export const InlineVideoSearchResult: FC<{ result: VideoSearchResultItem }> = ({ result }) => {
  const { t } = useTranslation()
  const [opened, setOpened] = useState(false)
  const [thumbnailFailed, setThumbnailFailed] = useState(false)
  const canPlayInApp = result.playbackMode !== 'webpage' && Boolean(result.playbackUrl)
  const playbackLabel = canPlayInApp ? t('Play in Chatbox') : t('Open webpage')
  const metadata = [result.source, result.author, result.duration].filter(Boolean).join(' · ')

  const activate = () => {
    if (canPlayInApp) setOpened(true)
    else void platform.openLink(result.url)
  }

  return (
    <span className="my-3 block w-full max-w-2xl overflow-hidden rounded-lg border border-chatbox-border-primary bg-chatbox-background-secondary">
      <button
        type="button"
        className="group relative block aspect-video w-full cursor-pointer overflow-hidden border-0 bg-black p-0 text-left"
        aria-label={`${playbackLabel}: ${result.title}`}
        onClick={activate}
      >
        {result.thumbnailUrl && !thumbnailFailed ? (
          <img
            src={result.thumbnailUrl}
            alt={result.title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={() => setThumbnailFailed(true)}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-chatbox-background-gray-secondary text-chatbox-tint-secondary">
            <IconWorld size={42} />
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/30">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/70 text-white shadow-lg">
            {canPlayInApp ? <IconPlayerPlayFilled size={28} /> : <IconExternalLink size={26} />}
          </span>
        </span>
        <span className="absolute bottom-2 left-2 rounded bg-black/75 px-2 py-1 text-xs font-medium text-white">
          {playbackLabel}
        </span>
      </button>
      <span className="block p-2.5">
        <span className="block text-sm font-semibold text-chatbox-tint-primary">{result.title}</span>
        {metadata && <span className="mt-1 block text-xs text-chatbox-tint-secondary">{metadata}</span>}
        <button
          type="button"
          className="mt-1.5 cursor-pointer border-0 bg-transparent p-0 text-xs text-chatbox-tint-brand"
          onClick={() => void platform.openLink(result.url)}
        >
          {t('Open webpage')}
        </button>
      </span>

      <Modal opened={opened} onClose={() => setOpened(false)} title={result.title} centered size="xl">
        <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
          {opened && result.playbackMode === 'video' ? (
            <video src={result.playbackUrl} controls autoPlay playsInline className="h-full w-full" />
          ) : opened ? (
            <iframe
              src={result.playbackUrl}
              title={result.title}
              className="h-full w-full border-0"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
              referrerPolicy="origin-when-cross-origin"
              allowFullScreen
            />
          ) : null}
        </div>
      </Modal>
    </span>
  )
}

export const VideoSearchResultGallery: FC<{ results: VideoSearchResultItem[] }> = ({ results }) => {
  const { t } = useTranslation()
  const playable = results.filter((result) => result.playbackMode !== 'webpage' && Boolean(result.playbackUrl))
  const webpageOnly = results.filter((result) => result.playbackMode === 'webpage' || !result.playbackUrl)

  return (
    <div className="my-3 space-y-4">
      {playable.length > 0 && (
        <section>
          <div className="mb-2 text-sm font-semibold text-chatbox-tint-primary">{t('Play in Chatbox')}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {playable.map((result) => (
              <InlineVideoSearchResult key={result.url} result={result} />
            ))}
          </div>
        </section>
      )}
      {webpageOnly.length > 0 && (
        <section>
          <div className="mb-2 text-sm font-semibold text-chatbox-tint-primary">{t('Open webpage')}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {webpageOnly.map((result) => (
              <InlineVideoSearchResult key={result.url} result={result} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
