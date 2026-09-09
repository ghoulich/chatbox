import {
  Alert,
  Button,
  FileButton,
  Flex,
  NumberInput,
  PasswordInput,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import { IconInfoCircle, IconUpload } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  checkComfyUIConnection,
  inspectComfyUIWorkflowDimensions,
  loadComfyUICheckpoints,
  parseComfyUIWorkflow,
} from '@/packages/comfyui/client'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/comfyui')({ component: RouteComponent })

export function RouteComponent() {
  const { t } = useTranslation()
  const comfyui = useSettingsStore((state) => state.comfyui)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const [checking, setChecking] = useState(false)
  const [mappingText, setMappingText] = useState(() => JSON.stringify(comfyui.inputMapping, null, 2))
  const detectedDimensions = useMemo(() => {
    if (!comfyui.workflowJson.trim()) return undefined
    try {
      const result = inspectComfyUIWorkflowDimensions(comfyui.workflowJson, comfyui.inputMapping)
      return result.width && result.height ? result : undefined
    } catch {
      return undefined
    }
  }, [comfyui.workflowJson, comfyui.inputMapping])

  useEffect(() => setMappingText(JSON.stringify(comfyui.inputMapping, null, 2)), [comfyui.inputMapping])

  const update = (value: Partial<typeof comfyui>) => setSettings({ comfyui: { ...comfyui, ...value } })

  const importWorkflow = async (file: File | null) => {
    if (!file) return
    try {
      const workflowJson = await file.text()
      parseComfyUIWorkflow(workflowJson)
      update({ workflowJson, workflowName: file.name.replace(/\.json$/i, '') || comfyui.workflowName })
      toast.success(t('ComfyUI API workflow imported.'))
    } catch (error) {
      toast.error(
        `${t('Unable to import ComfyUI workflow.')}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const saveMapping = () => {
    try {
      const value = JSON.parse(mappingText) as Record<string, unknown>
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('Expected a JSON object.')!)
      const allowed = new Set([
        'positivePrompt',
        'negativePrompt',
        'checkpoint',
        'width',
        'height',
        'seed',
        'steps',
        'batchSize',
      ])
      if (Object.entries(value).some(([key, item]) => !allowed.has(key) || typeof item !== 'string')) {
        throw new Error(t('Mapping keys or values are invalid.')!)
      }
      update({ inputMapping: value as typeof comfyui.inputMapping })
      toast.success(t('ComfyUI parameter mapping saved.'))
    } catch (error) {
      toast.error(`${t('Invalid parameter mapping.')}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const checkConnection = async () => {
    setChecking(true)
    try {
      await checkComfyUIConnection(comfyui)
      const checkpoints = await loadComfyUICheckpoints(comfyui)
      toast.success(t('Connected to ComfyUI. Found {{count}} checkpoint models.', { count: checkpoints.length }))
    } catch (error) {
      toast.error(`${t('Unable to connect to ComfyUI.')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setChecking(false)
    }
  }

  return (
    <Stack p="md" gap="lg">
      <Title order={5}>{t('ComfyUI Image Generation')}</Title>
      <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
        <Text size="sm">
          {t(
            'Chatbox sends prompts to your self-hosted ComfyUI API, waits for the workflow, and stores the returned images in the local image history.'
          )}
        </Text>
      </Alert>

      <Switch
        label={t('Enable ComfyUI image generation')}
        description={t('When enabled, ComfyUI checkpoints appear in image model selectors.')}
        checked={comfyui.enabled}
        onChange={(event) => update({ enabled: event.currentTarget.checked })}
      />
      <TextInput
        label={t('ComfyUI Endpoint')}
        description={t('Use the base address of ComfyUI or your authenticated reverse proxy.')}
        placeholder="http://192.168.1.10:8188"
        value={comfyui.endpoint}
        onChange={(event) => update({ endpoint: event.currentTarget.value })}
      />
      <TextInput
        label={t('ComfyUI Username (optional)')}
        description={t('Required when your reverse proxy protects ComfyUI with Basic authentication.')}
        value={comfyui.username ?? ''}
        onChange={(event) => update({ username: event.currentTarget.value })}
      />
      <PasswordInput
        label={t('ComfyUI Password (optional)')}
        value={comfyui.password ?? ''}
        onChange={(event) => update({ password: event.currentTarget.value })}
      />
      <TextInput
        label={t('Workflow Name')}
        value={comfyui.workflowName}
        onChange={(event) => update({ workflowName: event.currentTarget.value })}
      />
      <Stack gap="xs">
        <Text fw={500} size="sm">
          {t('ComfyUI API Workflow JSON')}
        </Text>
        <Text size="xs" c="dimmed">
          {t('Export the workflow from ComfyUI using Save (API Format), then import or paste it here.')}
        </Text>
        <FileButton onChange={importWorkflow} accept="application/json,.json">
          {(props) => (
            <Button {...props} variant="light" leftSection={<IconUpload size={16} />} className="self-start">
              {t('Import API Workflow')}
            </Button>
          )}
        </FileButton>
        <Textarea
          autosize
          minRows={8}
          maxRows={20}
          value={comfyui.workflowJson}
          placeholder='{"3":{"inputs":{},"class_type":"KSampler"}}'
          onChange={(event) => update({ workflowJson: event.currentTarget.value })}
        />
      </Stack>

      <Stack gap="xs">
        <Text fw={500} size="sm">
          {t('Parameter Mapping (JSON)')}
        </Text>
        <Text size="xs" c="dimmed">
          {t(
            'Each value uses nodeId.inputName, for example {"positivePrompt":"6.text","checkpoint":"4.ckpt_name"}. Standard workflows are detected automatically when a value is omitted.'
          )}
        </Text>
        <Textarea
          autosize
          minRows={6}
          maxRows={14}
          value={mappingText}
          onChange={(e) => setMappingText(e.currentTarget.value)}
        />
        <Button variant="light" onClick={saveMapping} className="self-start">
          {t('Save Parameter Mapping')}
        </Button>
      </Stack>

      <TextInput
        label={t('Output Node ID (optional)')}
        description={t('Leave blank to collect images from every workflow output node.')}
        value={comfyui.outputNodeId ?? ''}
        onChange={(event) => update({ outputNodeId: event.currentTarget.value })}
      />
      <Textarea
        label={t('Default Negative Prompt (optional)')}
        autosize
        minRows={2}
        value={comfyui.defaultNegativePrompt ?? ''}
        onChange={(event) => update({ defaultNegativePrompt: event.currentTarget.value })}
      />
      {detectedDimensions && (
        <Alert color="green" variant="light" icon={<IconInfoCircle size={16} />}>
          <Text size="sm">
            {t('Detected workflow resolution: {{width}} × {{height}}. It takes priority over the defaults below.', {
              width: detectedDimensions.width,
              height: detectedDimensions.height,
            })}
          </Text>
        </Alert>
      )}
      <Flex gap="md" wrap="wrap">
        <NumberInput
          flex={1}
          miw={180}
          label={t('Default Width (when missing)')}
          description={t('Used only when the corresponding workflow value is missing or invalid.')}
          min={64}
          max={8192}
          step={64}
          value={comfyui.defaultWidth}
          onChange={(value) => update({ defaultWidth: Number(value) || 1024 })}
        />
        <NumberInput
          flex={1}
          miw={180}
          label={t('Default Height (when missing)')}
          description={t('Used only when the corresponding workflow value is missing or invalid.')}
          min={64}
          max={8192}
          step={64}
          value={comfyui.defaultHeight}
          onChange={(value) => update({ defaultHeight: Number(value) || 1024 })}
        />
        <NumberInput
          flex={1}
          miw={180}
          label={t('Generation Timeout (seconds)')}
          min={30}
          max={1800}
          value={comfyui.timeoutSeconds}
          onChange={(value) => update({ timeoutSeconds: Number(value) || 600 })}
        />
      </Flex>
      <Button onClick={checkConnection} loading={checking} disabled={!comfyui.endpoint.trim()} className="self-start">
        {t('Check ComfyUI Connection')}
      </Button>
    </Stack>
  )
}
