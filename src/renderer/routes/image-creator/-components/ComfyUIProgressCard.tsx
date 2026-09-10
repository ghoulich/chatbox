import { Progress, Stack, Text } from '@mantine/core'
import type { ImageGenerationProgress } from '@shared/types'
import { useTranslation } from 'react-i18next'

const stageLabels: Record<ImageGenerationProgress['stage'], string> = {
  preparing: 'Preparing',
  uploading: 'Upload',
  queued: 'Queued',
  running: 'Generating image',
  downloading: 'Downloading...',
  completed: 'Done',
  cancelled: 'Generation cancelled',
}

export function ComfyUIProgressCard({ progress }: { progress: ImageGenerationProgress }) {
  const { t } = useTranslation()
  const isTerminal = progress.stage === 'completed' || progress.stage === 'cancelled'
  return (
    <Stack gap={6} maw={460} mx="auto" w="100%">
      <Text size="sm" ta="center">
        {t(stageLabels[progress.stage])}
        {progress.queuePosition ? ` · ${t('Queue position: {{position}}', { position: progress.queuePosition })}` : ''}
      </Text>
      <Progress
        value={progress.percent ?? 0}
        animated={!isTerminal}
        color={progress.stage === 'cancelled' ? 'gray' : undefined}
        radius="xl"
      />
    </Stack>
  )
}
