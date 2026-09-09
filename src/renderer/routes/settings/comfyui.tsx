import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  FileButton,
  Flex,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import {
  IconCloudDownload,
  IconCloudUpload,
  IconInfoCircle,
  IconRefresh,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  BridgeRevisionConflictError,
  checkWorkflowBridge,
  deleteBridgeWorkflow,
  getBridgeWorkflow,
  listBridgeWorkflows,
  profileFromBridgeBundle,
  saveBridgeWorkflow,
  type BridgeUnmanagedWorkflow,
  type BridgeWorkflowMetadata,
} from '@/packages/comfyui/bridge-client'
import {
  checkComfyUIConnection,
  inspectComfyUIWorkflowDimensions,
  loadComfyUICheckpoints,
  loadComfyUIControlNets,
  loadComfyUILoras,
  parseComfyUIWorkflow,
} from '@/packages/comfyui/client'
import {
  activateWorkflow,
  COMFYUI_SAMPLERS,
  COMFYUI_SCHEDULERS,
  createImportedWorkflowProfile,
  createTextToImageProfile,
  DEFAULT_COMFYUI_BUILDER,
  ensureWorkflowLibrary,
  removeWorkflow,
  upsertAndActivateWorkflow,
  type ComfyUIWorkflowBuilder,
  type ComfyUIWorkflowProfile,
} from '@/packages/comfyui/workflows'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/comfyui')({ component: RouteComponent })

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function numberInputValue(value: string | number, fallback: number, minimum: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= minimum ? number : fallback
}

export function RouteComponent() {
  const { t } = useTranslation()
  const comfyui = useSettingsStore((state) => state.comfyui)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const [checking, setChecking] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [mappingText, setMappingText] = useState(() => JSON.stringify(comfyui.inputMapping, null, 2))
  const [checkpoints, setCheckpoints] = useState<string[]>([])
  const [loras, setLoras] = useState<string[]>([])
  const [controlNets, setControlNets] = useState<string[]>([])
  const [remoteWorkflows, setRemoteWorkflows] = useState<BridgeWorkflowMetadata[]>([])
  const [unmanagedWorkflows, setUnmanagedWorkflows] = useState<BridgeUnmanagedWorkflow[]>([])
  const [confirmAction, setConfirmAction] = useState<'local' | 'remote' | null>(null)
  const [builderName, setBuilderName] = useState(t('New text-to-image workflow') ?? 'New text-to-image workflow')
  const [builder, setBuilder] = useState<ComfyUIWorkflowBuilder>({ ...DEFAULT_COMFYUI_BUILDER })

  const activeProfile = useMemo(
    () => comfyui.workflowProfiles.find((item) => item.id === comfyui.activeWorkflowId),
    [comfyui.activeWorkflowId, comfyui.workflowProfiles]
  )
  const detectedDimensions = useMemo(() => {
    if (!comfyui.workflowJson.trim()) return undefined
    try {
      const result = inspectComfyUIWorkflowDimensions(comfyui.workflowJson, comfyui.inputMapping)
      return result.width && result.height ? result : undefined
    } catch {
      return undefined
    }
  }, [comfyui.workflowJson, comfyui.inputMapping])

  useEffect(() => {
    const ensured = ensureWorkflowLibrary(comfyui)
    if (ensured !== comfyui) setSettings({ comfyui: ensured })
  }, [comfyui, setSettings])
  useEffect(() => setMappingText(JSON.stringify(comfyui.inputMapping, null, 2)), [comfyui.inputMapping])

  const update = (value: Partial<typeof comfyui>) => setSettings({ comfyui: { ...comfyui, ...value } })
  const updateActive = (value: Partial<ComfyUIWorkflowProfile>) => {
    if (!activeProfile) return
    const profile = { ...activeProfile, ...value, updatedAt: Date.now() }
    setSettings({ comfyui: upsertAndActivateWorkflow(comfyui, profile) })
  }

  const importWorkflow = async (file: File | null) => {
    if (!file) return
    try {
      const workflowJson = await file.text()
      parseComfyUIWorkflow(workflowJson)
      const profile = createImportedWorkflowProfile(file.name.replace(/\.json$/i, ''), workflowJson)
      setSettings({ comfyui: upsertAndActivateWorkflow(comfyui, profile) })
      toast.success(t('ComfyUI API workflow imported.'))
    } catch (error) {
      toast.error(`${t('Unable to import ComfyUI workflow.')}: ${errorMessage(error)}`)
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
        'image',
        'denoise',
      ])
      if (Object.entries(value).some(([key, item]) => !allowed.has(key) || typeof item !== 'string')) {
        throw new Error(t('Mapping keys or values are invalid.')!)
      }
      const inputMapping = value as typeof comfyui.inputMapping
      if (activeProfile) updateActive({ inputMapping })
      else update({ inputMapping })
      toast.success(t('ComfyUI parameter mapping saved.'))
    } catch (error) {
      toast.error(`${t('Invalid parameter mapping.')}: ${errorMessage(error)}`)
    }
  }

  const checkConnection = async () => {
    setChecking(true)
    try {
      await checkComfyUIConnection(comfyui)
      const [checkpointValues, loraValues, controlNetValues] = await Promise.all([
        loadComfyUICheckpoints(comfyui),
        loadComfyUILoras(comfyui),
        loadComfyUIControlNets(comfyui),
      ])
      setCheckpoints(checkpointValues)
      setLoras(loraValues)
      setControlNets(controlNetValues)
      toast.success(t('Connected to ComfyUI. Found {{count}} checkpoint models.', { count: checkpointValues.length }))
    } catch (error) {
      toast.error(`${t('Unable to connect to ComfyUI.')}: ${errorMessage(error)}`)
    } finally {
      setChecking(false)
    }
  }

  const refreshBridge = async () => {
    setSyncing(true)
    try {
      const health = await checkWorkflowBridge(comfyui)
      const result = await listBridgeWorkflows(comfyui)
      setRemoteWorkflows(result.workflows)
      setUnmanagedWorkflows(result.unmanaged)
      toast.success(
        t('Workflow Bridge {{version}} is ready. Found {{count}} synchronized workflows.', {
          version: health.version,
          count: result.workflows.length,
        })
      )
    } catch (error) {
      toast.error(`${t('Unable to access ComfyUI Workflow Bridge.')}: ${errorMessage(error)}`)
    } finally {
      setSyncing(false)
    }
  }

  const pushActive = async () => {
    if (!activeProfile) return
    setSyncing(true)
    try {
      const bundle = await saveBridgeWorkflow(comfyui, activeProfile)
      const profile = profileFromBridgeBundle(bundle, activeProfile)
      setSettings({ comfyui: upsertAndActivateWorkflow(comfyui, profile) })
      const result = await listBridgeWorkflows(comfyui)
      setRemoteWorkflows(result.workflows)
      setUnmanagedWorkflows(result.unmanaged)
      toast.success(t('Workflow synchronized to ComfyUI.'))
    } catch (error) {
      toast.error(
        error instanceof BridgeRevisionConflictError
          ? t('The ComfyUI copy changed. Refresh and pull it before saving again.')
          : `${t('Unable to synchronize workflow.')}: ${errorMessage(error)}`
      )
    } finally {
      setSyncing(false)
    }
  }

  const pullRemote = async (remote: BridgeWorkflowMetadata) => {
    setSyncing(true)
    try {
      const bundle = await getBridgeWorkflow(comfyui, remote.id)
      const existing = comfyui.workflowProfiles.find((item) => item.remote?.id === remote.id)
      const profile = profileFromBridgeBundle(bundle, existing)
      setSettings({ comfyui: upsertAndActivateWorkflow(comfyui, profile) })
      toast.success(t('Workflow downloaded from ComfyUI.'))
    } catch (error) {
      toast.error(`${t('Unable to download workflow.')}: ${errorMessage(error)}`)
    } finally {
      setSyncing(false)
    }
  }

  const deleteRemote = async () => {
    if (!activeProfile?.remote) return
    setConfirmAction(null)
    setSyncing(true)
    try {
      await deleteBridgeWorkflow(comfyui, activeProfile.remote)
      setSettings({ comfyui: removeWorkflow(comfyui, activeProfile.id) })
      const result = await listBridgeWorkflows(comfyui)
      setRemoteWorkflows(result.workflows)
      setUnmanagedWorkflows(result.unmanaged)
      toast.success(t('Synchronized workflow deleted.'))
    } catch (error) {
      toast.error(
        error instanceof BridgeRevisionConflictError
          ? t('The ComfyUI copy changed. Refresh before deleting it.')
          : `${t('Unable to delete workflow.')}: ${errorMessage(error)}`
      )
    } finally {
      setSyncing(false)
    }
  }

  const deleteLocal = () => {
    if (!activeProfile) return
    setConfirmAction(null)
    setSettings({ comfyui: removeWorkflow(comfyui, activeProfile.id) })
  }

  const createFromBuilder = () => {
    if (!builderName.trim()) {
      toast.error(t('Workflow name is required.'))
      return
    }
    if (!builder.checkpoint.trim()) {
      toast.error(t('Select a checkpoint model first.'))
      return
    }
    if (builder.mode === 'controlnet' && !builder.controlNetName?.trim()) {
      toast.error(t('Select a ControlNet model first.'))
      return
    }
    const profile = createTextToImageProfile(builderName, builder)
    setSettings({ comfyui: upsertAndActivateWorkflow(comfyui, profile) })
    toast.success(t('Workflow created and selected.'))
  }

  const workflowOptions = comfyui.workflowProfiles.map((profile) => ({
    value: profile.id,
    label: profile.remote ? `${profile.name} · ${t('Synchronized')}` : profile.name,
  }))

  return (
    <Stack p="md" gap="lg">
      <Modal opened={confirmAction !== null} onClose={() => setConfirmAction(null)} title={t('Delete')} centered>
        <Stack gap="md">
          <Text size="sm">
            {confirmAction === 'remote'
              ? t('Delete this synchronized workflow from ComfyUI and remove the local copy?')
              : t('Remove this workflow from ChatBox? The synchronized ComfyUI copy will be kept.')}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmAction(null)}>
              {t('Cancel')}
            </Button>
            <Button color="red" onClick={() => void (confirmAction === 'remote' ? deleteRemote() : deleteLocal())}>
              {t('Delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Title order={5}>{t('ComfyUI Image Generation')}</Title>
      <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
        <Text size="sm">
          {t(
            'Chatbox sends prompts to your self-hosted ComfyUI API, waits for the workflow, and stores the returned images in the local image history.'
          )}
        </Text>
      </Alert>

      <Tabs defaultValue="connection" keepMounted={false}>
        <Tabs.List grow>
          <Tabs.Tab value="connection">{t('Connection')}</Tabs.Tab>
          <Tabs.Tab value="workflows">{t('Workflow Library')}</Tabs.Tab>
          <Tabs.Tab value="designer">{t('Workflow Designer')}</Tabs.Tab>
          <Tabs.Tab value="advanced">{t('Advanced')}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="connection" pt="md">
          <Stack gap="md">
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
              label={t('ComfyUI User ID (optional)')}
              description={t('Set this only when ComfyUI multi-user mode requires a Comfy-User header.')}
              value={comfyui.userId ?? ''}
              onChange={(event) => update({ userId: event.currentTarget.value })}
            />
            <Group>
              <Button onClick={checkConnection} loading={checking} disabled={!comfyui.endpoint.trim()}>
                {t('Check ComfyUI Connection')}
              </Button>
              <Button variant="light" onClick={refreshBridge} loading={syncing} disabled={!comfyui.endpoint.trim()}>
                {t('Check Workflow Bridge')}
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="workflows" pt="md">
          <Stack gap="md">
            <Select
              label={t('Active Workflow')}
              description={t('The selected workflow is used for new ComfyUI image generations.')}
              placeholder={t('No workflow configured') ?? undefined}
              data={workflowOptions}
              value={comfyui.activeWorkflowId ?? null}
              onChange={(value) => value && setSettings({ comfyui: activateWorkflow(comfyui, value) })}
            />
            {activeProfile && (
              <Card withBorder padding="md">
                <Stack gap="xs">
                  <Group justify="space-between" wrap="wrap">
                    <Text fw={600}>{activeProfile.name}</Text>
                    <Group gap="xs">
                      <Badge color={activeProfile.remote ? 'green' : 'gray'}>
                        {activeProfile.remote
                          ? t('Synchronized revision {{revision}}', { revision: activeProfile.remote.revision })
                          : t('Local only')}
                      </Badge>
                      {!activeProfile.uiWorkflowJson && <Badge color="orange">{t('API workflow only')}</Badge>}
                    </Group>
                  </Group>
                  <Group>
                    <Button
                      variant="light"
                      leftSection={<IconCloudUpload size={16} />}
                      onClick={pushActive}
                      loading={syncing}
                      disabled={!activeProfile.uiWorkflowJson}
                    >
                      {t('Sync to ComfyUI')}
                    </Button>
                    <Button
                      variant="subtle"
                      color="red"
                      leftSection={<IconTrash size={16} />}
                      onClick={() => setConfirmAction('local')}
                    >
                      {t('Remove local copy')}
                    </Button>
                    {activeProfile.remote && (
                      <Button variant="subtle" color="red" onClick={() => setConfirmAction('remote')} loading={syncing}>
                        {t('Delete both copies')}
                      </Button>
                    )}
                  </Group>
                </Stack>
              </Card>
            )}
            <Divider label={t('ComfyUI synchronized workflows')} labelPosition="left" />
            <Button
              variant="light"
              leftSection={<IconRefresh size={16} />}
              onClick={refreshBridge}
              loading={syncing}
              className="self-start"
            >
              {t('Refresh from ComfyUI')}
            </Button>
            {remoteWorkflows.length === 0 ? (
              <Text size="sm" c="dimmed">
                {t('No synchronized workflows found.')}
              </Text>
            ) : (
              remoteWorkflows.map((remote) => (
                <Card key={remote.id} withBorder padding="sm">
                  <Group justify="space-between" wrap="wrap">
                    <Stack gap={2}>
                      <Text size="sm" fw={600}>
                        {remote.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t('Revision {{revision}}', { revision: remote.revision })}
                      </Text>
                    </Stack>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconCloudDownload size={14} />}
                      onClick={() => pullRemote(remote)}
                      loading={syncing}
                    >
                      {t('Pull into ChatBox')}
                    </Button>
                  </Group>
                </Card>
              ))
            )}
            {unmanagedWorkflows.length > 0 && (
              <Alert color="yellow" variant="light" icon={<IconInfoCircle size={16} />}>
                <Text size="sm">
                  {t(
                    '{{count}} ComfyUI workflows are not synchronized. Open each one in ComfyUI and use “Chatbox Bridge → Sync current workflow to ChatBox”.',
                    { count: unmanagedWorkflows.length }
                  )}
                </Text>
              </Alert>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="designer" pt="md">
          <Stack gap="md">
            <Alert color="cyan" variant="light" icon={<IconInfoCircle size={16} />}>
              <Text size="sm">
                {t(
                  'Create an executable workflow with a mobile-friendly form. You can refine its node graph later in ComfyUI.'
                )}
              </Text>
            </Alert>
            <TextInput
              label={t('Workflow Name')}
              value={builderName}
              onChange={(event) => setBuilderName(event.currentTarget.value)}
            />
            <Select
              label={t('Workflow Type')}
              data={[
                { value: 'text-to-image', label: t('Text to Image') },
                { value: 'image-to-image', label: t('Image to Image') },
                { value: 'controlnet', label: t('ControlNet') },
              ]}
              value={builder.mode}
              onChange={(value) =>
                value &&
                setBuilder((current) => ({
                  ...current,
                  mode: value as ComfyUIWorkflowBuilder['mode'],
                }))
              }
            />
            <Select
              searchable
              label={t('Checkpoint Model')}
              description={t('Check the connection first to load checkpoint models.')}
              data={checkpoints}
              value={builder.checkpoint || null}
              onChange={(value) => setBuilder((current) => ({ ...current, checkpoint: value ?? '' }))}
            />
            <Select
              searchable
              clearable
              label={t('LoRA Model (optional)')}
              description={t('Leave empty to use the checkpoint without a LoRA adapter.')}
              data={loras}
              value={builder.loraName ?? null}
              onChange={(value) => setBuilder((current) => ({ ...current, loraName: value ?? undefined }))}
            />
            {builder.loraName && (
              <NumberInput
                label={t('LoRA Strength')}
                min={-10}
                max={10}
                step={0.05}
                decimalScale={2}
                value={builder.loraStrength}
                onChange={(value) =>
                  setBuilder((current) => ({ ...current, loraStrength: numberInputValue(value, 1, -10) }))
                }
              />
            )}
            {builder.mode === 'image-to-image' && (
              <>
                <Alert color="blue" variant="light">
                  <Text size="sm">{t('This workflow requires one reference image for every generation.')}</Text>
                </Alert>
                <NumberInput
                  label={t('Denoise Strength')}
                  description={t('Lower values preserve more of the reference image.')}
                  min={0}
                  max={1}
                  step={0.05}
                  decimalScale={2}
                  value={builder.denoise}
                  onChange={(value) =>
                    setBuilder((current) => ({ ...current, denoise: numberInputValue(value, 0.75, 0) }))
                  }
                />
              </>
            )}
            {builder.mode === 'controlnet' && (
              <>
                <Alert color="blue" variant="light">
                  <Text size="sm">{t('This workflow requires one reference image for every generation.')}</Text>
                </Alert>
                <Select
                  searchable
                  label={t('ControlNet Model')}
                  data={controlNets}
                  value={builder.controlNetName ?? null}
                  onChange={(value) => setBuilder((current) => ({ ...current, controlNetName: value ?? undefined }))}
                />
                <Flex gap="md" wrap="wrap">
                  <NumberInput
                    flex={1}
                    miw={130}
                    label={t('Control Strength')}
                    min={0}
                    max={10}
                    step={0.05}
                    decimalScale={2}
                    value={builder.controlNetStrength}
                    onChange={(value) =>
                      setBuilder((current) => ({
                        ...current,
                        controlNetStrength: numberInputValue(value, 1, 0),
                      }))
                    }
                  />
                  <NumberInput
                    flex={1}
                    miw={130}
                    label={t('Start Percent')}
                    min={0}
                    max={1}
                    step={0.05}
                    decimalScale={2}
                    value={builder.controlNetStart}
                    onChange={(value) =>
                      setBuilder((current) => ({ ...current, controlNetStart: numberInputValue(value, 0, 0) }))
                    }
                  />
                  <NumberInput
                    flex={1}
                    miw={130}
                    label={t('End Percent')}
                    min={0}
                    max={1}
                    step={0.05}
                    decimalScale={2}
                    value={builder.controlNetEnd}
                    onChange={(value) =>
                      setBuilder((current) => ({ ...current, controlNetEnd: numberInputValue(value, 1, 0) }))
                    }
                  />
                </Flex>
              </>
            )}
            {builder.mode !== 'image-to-image' && (
              <Flex gap="md" wrap="wrap">
                <NumberInput
                  flex={1}
                  miw={140}
                  label={t('Width')}
                  min={64}
                  max={8192}
                  step={64}
                  value={builder.width}
                  onChange={(value) =>
                    setBuilder((current) => ({ ...current, width: numberInputValue(value, 512, 64) }))
                  }
                />
                <NumberInput
                  flex={1}
                  miw={140}
                  label={t('Height')}
                  min={64}
                  max={8192}
                  step={64}
                  value={builder.height}
                  onChange={(value) =>
                    setBuilder((current) => ({ ...current, height: numberInputValue(value, 512, 64) }))
                  }
                />
              </Flex>
            )}
            <Flex gap="md" wrap="wrap">
              <Select
                flex={1}
                miw={180}
                label={t('Sampler')}
                data={[...COMFYUI_SAMPLERS]}
                value={builder.sampler}
                onChange={(value) => value && setBuilder((current) => ({ ...current, sampler: value }))}
              />
              <Select
                flex={1}
                miw={180}
                label={t('Scheduler')}
                data={[...COMFYUI_SCHEDULERS]}
                value={builder.scheduler}
                onChange={(value) => value && setBuilder((current) => ({ ...current, scheduler: value }))}
              />
            </Flex>
            <Flex gap="md" wrap="wrap">
              <NumberInput
                flex={1}
                miw={120}
                label={t('Steps')}
                min={1}
                max={150}
                value={builder.steps}
                onChange={(value) => setBuilder((current) => ({ ...current, steps: numberInputValue(value, 20, 1) }))}
              />
              <NumberInput
                flex={1}
                miw={120}
                label={t('CFG Scale')}
                min={0}
                max={100}
                decimalScale={1}
                value={builder.cfg}
                onChange={(value) => setBuilder((current) => ({ ...current, cfg: numberInputValue(value, 7, 0) }))}
              />
              <NumberInput
                flex={1}
                miw={160}
                label={t('Seed (-1 = random)')}
                min={-1}
                value={builder.seed}
                onChange={(value) => setBuilder((current) => ({ ...current, seed: numberInputValue(value, -1, -1) }))}
              />
            </Flex>
            <Button onClick={createFromBuilder} className="self-start">
              {t('Create and select workflow')}
            </Button>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="advanced" pt="md">
          <Stack gap="md">
            <TextInput
              label={t('Workflow Name')}
              value={comfyui.workflowName}
              onChange={(event) =>
                activeProfile
                  ? updateActive({ name: event.currentTarget.value })
                  : update({ workflowName: event.currentTarget.value })
              }
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
                onChange={(event) =>
                  activeProfile
                    ? updateActive({ apiWorkflowJson: event.currentTarget.value })
                    : update({ workflowJson: event.currentTarget.value })
                }
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
                onChange={(event) => setMappingText(event.currentTarget.value)}
              />
              <Button variant="light" onClick={saveMapping} className="self-start">
                {t('Save Parameter Mapping')}
              </Button>
            </Stack>
            <TextInput
              label={t('Output Node ID (optional)')}
              description={t('Leave blank to collect images from every workflow output node.')}
              value={comfyui.outputNodeId ?? ''}
              onChange={(event) =>
                activeProfile
                  ? updateActive({ outputNodeId: event.currentTarget.value })
                  : update({ outputNodeId: event.currentTarget.value })
              }
            />
            <Textarea
              label={t('Default Negative Prompt (optional)')}
              autosize
              minRows={2}
              value={comfyui.defaultNegativePrompt ?? ''}
              onChange={(event) =>
                activeProfile
                  ? updateActive({ defaultNegativePrompt: event.currentTarget.value })
                  : update({ defaultNegativePrompt: event.currentTarget.value })
              }
            />
            {detectedDimensions && (
              <Alert color="green" variant="light" icon={<IconInfoCircle size={16} />}>
                <Text size="sm">
                  {t(
                    'Detected workflow resolution: {{width}} × {{height}}. It takes priority over the defaults below.',
                    { width: detectedDimensions.width, height: detectedDimensions.height }
                  )}
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
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
