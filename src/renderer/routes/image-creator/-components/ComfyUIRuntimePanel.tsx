import { Button, Collapse, Divider, Flex, NumberInput, Select, Stack, Text } from '@mantine/core'
import type { ComfyUIRuntimeParameters, Settings } from '@shared/types'
import { IconChevronDown, IconChevronUp, IconRestore } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import {
  getComfyUIRuntimeParameterDescriptors,
  type ComfyUIRuntimeParameterDescriptor,
} from '@/packages/comfyui/workflows'

type ComfyUIWorkflowProfile = Settings['comfyui']['workflowProfiles'][number]

const labelKeys: Record<keyof ComfyUIRuntimeParameters, string> = {
  width: 'Width',
  height: 'Height',
  steps: 'Sampling Steps',
  cfg: 'CFG Scale',
  seed: 'Seed (-1 = random)',
  sampler: 'Sampler',
  scheduler: 'Scheduler',
  denoise: 'Denoise Strength',
  loraStrength: 'LoRA Strength',
  controlNetStrength: 'Control Strength',
  controlNetStart: 'Start Percent',
  controlNetEnd: 'End Percent',
}

function RuntimeField({
  descriptor,
  parameters,
  onChange,
}: {
  descriptor: ComfyUIRuntimeParameterDescriptor
  parameters: ComfyUIRuntimeParameters
  onChange: (parameters: ComfyUIRuntimeParameters) => void
}) {
  const { t } = useTranslation()
  const value = parameters[descriptor.key]
  if (descriptor.options) {
    return (
      <Select
        label={t(labelKeys[descriptor.key])}
        value={typeof value === 'string' ? value : null}
        data={descriptor.options.map((item) => ({ value: item, label: item }))}
        onChange={(next) => next && onChange({ ...parameters, [descriptor.key]: next })}
        searchable
        allowDeselect={false}
      />
    )
  }
  return (
    <NumberInput
      label={t(labelKeys[descriptor.key])}
      value={typeof value === 'number' ? value : ''}
      min={descriptor.minimum}
      max={descriptor.maximum}
      step={descriptor.step}
      decimalScale={descriptor.step && descriptor.step < 1 ? 2 : 0}
      onChange={(next) => {
        if (typeof next === 'number' && Number.isFinite(next)) {
          onChange({ ...parameters, [descriptor.key]: next })
        }
      }}
    />
  )
}

export function ComfyUIRuntimePanel({
  opened,
  profiles,
  activeWorkflowId,
  parameters,
  onClose,
  onWorkflowChange,
  onParametersChange,
  onReset,
}: {
  opened: boolean
  profiles: ComfyUIWorkflowProfile[]
  activeWorkflowId?: string
  parameters: ComfyUIRuntimeParameters
  onClose: () => void
  onWorkflowChange: (workflowId: string) => void
  onParametersChange: (parameters: ComfyUIRuntimeParameters) => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const profile = profiles.find((item) => item.id === activeWorkflowId)
  const descriptors = useMemo(() => getComfyUIRuntimeParameterDescriptors(profile), [profile])
  const basic = descriptors.filter((item) => item.group === 'basic')
  const advanced = descriptors.filter((item) => item.group === 'advanced')

  return (
    <AdaptiveModal opened={opened} onClose={onClose} title={t('Generation Parameters')} size="md">
      <Stack gap="md">
        <Select
          label={t('Active Workflow')}
          value={activeWorkflowId ?? null}
          data={profiles.map((item) => ({ value: item.id, label: item.name }))}
          onChange={(value) => value && onWorkflowChange(value)}
          allowDeselect={false}
        />

        {profile && (
          <Text size="xs" c="dimmed">
            {[
              profile.capabilities.textToImage ? t('Text to Image') : undefined,
              profile.capabilities.imageToImage ? t('Image to Image') : undefined,
              profile.capabilities.lora ? t('LoRA') : undefined,
              profile.capabilities.controlNet ? t('ControlNet') : undefined,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        )}

        <Divider label={t('Basic')} labelPosition="left" />
        {basic.map((descriptor) => (
          <RuntimeField
            key={descriptor.key}
            descriptor={descriptor}
            parameters={parameters}
            onChange={onParametersChange}
          />
        ))}

        {advanced.length > 0 && (
          <>
            <Button
              variant="subtle"
              justify="space-between"
              rightSection={advancedOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
              onClick={() => setAdvancedOpen((value) => !value)}
            >
              {t('Advanced')}
            </Button>
            <Collapse in={advancedOpen}>
              <Stack gap="sm">
                {advanced.map((descriptor) => (
                  <RuntimeField
                    key={descriptor.key}
                    descriptor={descriptor}
                    parameters={parameters}
                    onChange={onParametersChange}
                  />
                ))}
              </Stack>
            </Collapse>
          </>
        )}

        <Flex justify="space-between" gap="sm">
          <Button variant="light" leftSection={<IconRestore size={16} />} onClick={onReset}>
            {t('Reset to Workflow Defaults')}
          </Button>
          <Button onClick={onClose}>{t('Done')}</Button>
        </Flex>
      </Stack>
    </AdaptiveModal>
  )
}
