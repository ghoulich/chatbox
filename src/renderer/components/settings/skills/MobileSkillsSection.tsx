import { Alert, Badge, Box, Button, Flex, Loader, Paper, SimpleGrid, Switch, Text } from '@mantine/core'
import { IconAlertTriangle, IconFolderOpen, IconRefresh, IconSparkles } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { notifySkillsChanged } from '@/packages/skills/controller'
import { type MobileSkillScanError, scanMobileSkills } from '@/packages/skills/mobile-directory'
import { AndroidDocumentSaver } from '@/platform/android_document_saver'
import { toastError } from '@/packages/toast'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import type { SkillInfo } from '@shared/types/skills'

export function MobileSkillsSection() {
  const { t } = useTranslation()
  const skillSettings = useSettingsStore((state) => state.skills)
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [errors, setErrors] = useState<MobileSkillScanError[]>([])
  const [loading, setLoading] = useState(false)
  const [truncated, setTruncated] = useState(false)

  const refresh = useCallback(
    async (uri = settingsStore.getState().skills.mobileDirectoryUri) => {
      setLoading(true)
      try {
        const result = await scanMobileSkills(uri)
        setSkills(result.skills)
        setErrors(result.errors)
        setTruncated(result.truncated)

        settingsStore.getState().setSettings((draft) => {
          const previous = new Set(draft.skills.mobileKnownSkillNames)
          const discoveredNames = result.skills.map((skill) => skill.name)
          const newlyDiscovered = discoveredNames.filter((name) => !previous.has(name))
          draft.skills.enabledSkillNames = [...new Set([...draft.skills.enabledSkillNames, ...newlyDiscovered])]
          draft.skills.mobileKnownSkillNames = discoveredNames
        })
        notifySkillsChanged()
      } catch (error) {
        console.error('Failed to scan mobile skills directory:', error)
        toastError(t('Unable to scan the selected Skills directory. Please select it again.'))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selectDirectory = async () => {
    try {
      const selected = await AndroidDocumentSaver.selectSkillDirectory()
      settingsStore.getState().setSettings((draft) => {
        draft.skills.mobileDirectoryUri = selected.uri
        draft.skills.mobileDirectoryName = selected.name
        draft.skills.mobileKnownSkillNames = []
      })
      notifySkillsChanged()
      await refresh(selected.uri)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : String(error)
      if (/cancel/i.test(message)) return
      toastError(t('Unable to select the Skills directory.'))
    }
  }

  const toggleSkill = (name: string, enabled: boolean) => {
    settingsStore.getState().setSettings((draft) => {
      draft.skills.enabledSkillNames = enabled
        ? [...new Set([...draft.skills.enabledSkillNames, name])]
        : draft.skills.enabledSkillNames.filter((item) => item !== name)
    })
    notifySkillsChanged()
  }

  return (
    <Box>
      <Paper withBorder radius="lg" p="md" mb="lg">
        <Text size="sm" fw={600}>
          {t('Skills Directory')}
        </Text>
        <Text size="xs" c="dimmed" mt={4}>
          {t('Chatbox scans SKILL.md files in this directory. Files are read-only and should be edited on a computer.')}
        </Text>
        {skillSettings.mobileDirectoryUri && (
          <Text size="xs" ff="monospace" mt="sm" style={{ overflowWrap: 'anywhere' }}>
            {skillSettings.mobileDirectoryName || skillSettings.mobileDirectoryUri}
          </Text>
        )}
        <Flex gap="xs" mt="md" wrap="wrap">
          <Button size="xs" leftSection={<IconFolderOpen size={14} />} onClick={() => void selectDirectory()}>
            {t('Select Skills Directory')}
          </Button>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            disabled={!skillSettings.mobileDirectoryUri}
            loading={loading}
            onClick={() => void refresh()}
          >
            {t('Refresh Skills')}
          </Button>
        </Flex>
      </Paper>

      <Flex align="center" gap="xs" mb="sm">
        <Text size="sm" fw={600}>
          {t('Available Skills')}
        </Text>
        <Badge size="xs" variant="light" color="gray">
          {skills.length}
        </Badge>
        {loading && <Loader size="xs" />}
      </Flex>

      {skills.length === 0 && !loading ? (
        <Text size="sm" c="dimmed">
          {t('No Skills found in the selected directory.')}
        </Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {skills.map((skill) => (
            <Paper key={skill.path} withBorder radius="lg" p="sm">
              <Flex justify="space-between" gap="sm" align="flex-start">
                <Box style={{ minWidth: 0 }}>
                  <Flex align="center" gap={6}>
                    <ScalableIcon icon={IconSparkles} size={14} />
                    <Text size="sm" fw={600}>
                      {skill.name}
                    </Text>
                  </Flex>
                  <Text size="xs" c="dimmed" mt={6}>
                    {skill.description}
                  </Text>
                  <Text size="xs" c="dimmed" ff="monospace" mt={6} style={{ overflowWrap: 'anywhere' }}>
                    {skill.path}
                  </Text>
                </Box>
                <Switch
                  size="xs"
                  checked={skillSettings.enabledSkillNames.includes(skill.name)}
                  onChange={(event) => toggleSkill(skill.name, event.currentTarget.checked)}
                />
              </Flex>
            </Paper>
          ))}
        </SimpleGrid>
      )}

      {(errors.length > 0 || truncated) && (
        <Alert mt="lg" color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
          {truncated && <Text size="xs">{t('The Skills scan limit was reached. Some files were not scanned.')}</Text>}
          {errors.map((error) => (
            <Text key={`${error.path}:${error.message}`} size="xs" style={{ overflowWrap: 'anywhere' }}>
              {error.path}: {error.message}
            </Text>
          ))}
        </Alert>
      )}
    </Box>
  )
}
