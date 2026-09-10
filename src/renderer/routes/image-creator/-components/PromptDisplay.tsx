import { Button, Flex, Stack, Text } from '@mantine/core'
import { IconPhoto, IconRestore } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

export interface PromptDisplayProps {
  prompt: string
  modelDisplayName: string
  referenceImageCount: number
  workflowName?: string
  onReuseSettings?: () => void
}

export function PromptDisplay({
  prompt,
  modelDisplayName,
  referenceImageCount,
  workflowName,
  onReuseSettings,
}: PromptDisplayProps) {
  const { t } = useTranslation()

  return (
    <Stack gap={4} align="center" className="text-center">
      <Text size="sm" c="gray.7" style={{ lineHeight: 1.5, maxWidth: '90%' }}>
        {prompt}
      </Text>
      <Flex gap="sm" align="center" justify="center">
        <Text size="xs" c="gray.5">
          {modelDisplayName}
        </Text>
        {workflowName && (
          <Text size="xs" c="gray.5">
            · {workflowName}
          </Text>
        )}
        {referenceImageCount > 0 && (
          <>
            <Text size="xs" c="gray.5">
              •
            </Text>
            <Flex align="center" gap={4}>
              <IconPhoto size={12} className="opacity-50" />
              <Text size="xs" c="gray.5">
                {t('{{count}} ref', { count: referenceImageCount })}
              </Text>
            </Flex>
          </>
        )}
      </Flex>
      {onReuseSettings && (
        <Button variant="subtle" size="compact-xs" leftSection={<IconRestore size={13} />} onClick={onReuseSettings}>
          {t('Reuse Settings')}
        </Button>
      )}
    </Stack>
  )
}
