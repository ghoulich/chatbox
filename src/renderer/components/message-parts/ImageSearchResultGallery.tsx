import { Box, Button, Image, Paper, Stack, Text } from '@mantine/core'
import type { ImageSearchResultItem } from '@shared/image-search-tool'
import { IconExternalLink } from '@tabler/icons-react'
import { type FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageViewer, ImageViewerItem } from '@/components/ImageViewer'
import platform from '@/platform'

export function extractImageSearchResults(value: unknown): ImageSearchResultItem[] {
  if (!value || typeof value !== 'object') return []
  const items = (value as Record<string, unknown>).imageResults
  if (!Array.isArray(items)) return []
  return items.filter(
    (item): item is ImageSearchResultItem =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.title === 'string' &&
      typeof item.imageUrl === 'string' &&
      /^https?:\/\//i.test(item.imageUrl) &&
      typeof item.thumbnailUrl === 'string' &&
      /^https?:\/\//i.test(item.thumbnailUrl) &&
      typeof item.sourceUrl === 'string' &&
      /^https?:\/\//i.test(item.sourceUrl) &&
      typeof item.source === 'string' &&
      typeof item.resolution === 'string'
  )
}

export function collectImageSearchResults(
  parts: Array<{ type?: string; toolName?: string; result?: unknown }>
): ImageSearchResultItem[] {
  const seen = new Set<string>()
  const results: ImageSearchResultItem[] = []
  for (const part of parts) {
    if (part.type !== 'tool-call' || part.toolName !== 'image_search') continue
    for (const result of extractImageSearchResults(part.result)) {
      if (seen.has(result.imageUrl)) continue
      seen.add(result.imageUrl)
      results.push(result)
    }
  }
  return results
}

function parseResolution(resolution: string): { width: number; height: number } {
  const match = resolution.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!match) return { width: 1024, height: 1024 }
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? { width, height } : { width: 1024, height: 1024 }
}

const ImageSearchCard: FC<{ result: ImageSearchResultItem }> = ({ result }) => {
  const { t } = useTranslation()
  const [displayUrl, setDisplayUrl] = useState(result.thumbnailUrl || result.imageUrl)
  const [failed, setFailed] = useState(false)
  const size = parseResolution(result.resolution)

  const handleError = () => {
    if (displayUrl !== result.imageUrl) {
      setDisplayUrl(result.imageUrl)
      return
    }
    setFailed(true)
  }

  if (failed) return null

  return (
    <Paper radius="md" withBorder className="overflow-hidden" style={{ minWidth: 0 }}>
      <Box h={150} bg="var(--chatbox-background-gray-secondary)" className="flex items-center justify-center">
        <ImageViewerItem
          original={result.imageUrl}
          thumbnail={displayUrl}
          width={size.width}
          height={size.height}
          alt={result.title}
          caption={result.title}
        >
          {({ ref, open }) => (
            <Image
              ref={ref}
              src={displayUrl}
              alt={result.title}
              h={150}
              w="100%"
              fit="cover"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={handleError}
              onClick={open}
              className="cursor-zoom-in"
            />
          )}
        </ImageViewerItem>
      </Box>
      <Stack gap={4} p="xs">
        <Text size="xs" fw={600} lineClamp={2} title={result.title}>
          {result.title}
        </Text>
        {(result.source || result.resolution) && (
          <Text size="10px" c="chatbox-tertiary" truncate="end">
            {[result.source, result.resolution].filter(Boolean).join(' · ')}
          </Text>
        )}
        <Button
          size="compact-xs"
          variant="subtle"
          px={0}
          justify="flex-start"
          rightSection={<IconExternalLink size={11} />}
          onClick={() => platform.openLink(result.sourceUrl)}
        >
          {t('Open source')}
        </Button>
      </Stack>
    </Paper>
  )
}

export const ImageSearchResultGallery: FC<{ results: ImageSearchResultItem[] }> = ({ results }) => (
  <ImageViewer pictures={results.map((result) => ({ url: result.imageUrl }))}>
    <Box
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 8,
      }}
    >
      {results.map((result, index) => (
        <ImageSearchCard key={`${result.imageUrl}-${index}`} result={result} />
      ))}
    </Box>
  </ImageViewer>
)
