import {
  Alert,
  Box,
  Button,
  Flex,
  NumberInput,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { IconInfoCircle, IconTrash } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AndroidNetworkTools } from '@/platform/android_network_tools'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'

export const Route = createFileRoute('/settings/network-tools')({ component: RouteComponent })

function newId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

export function RouteComponent() {
  const { t } = useTranslation()
  const networkTools = useSettingsStore((state) => state.networkTools)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const [ssh, setSsh] = useState({ name: '', host: '', port: 22, username: '', password: '', fingerprint: '' })
  const [snmp, setSnmp] = useState({
    name: '',
    host: '',
    port: 161,
    version: '3' as '2c' | '3',
    community: '',
    securityName: '',
    authPassphrase: '',
    privPassphrase: '',
  })
  const [saving, setSaving] = useState(false)

  const update = (value: Partial<typeof networkTools>) => setSettings({ networkTools: { ...networkTools, ...value } })

  const saveSsh = async () => {
    if (!ssh.name.trim() || !ssh.host.trim() || !ssh.username.trim() || !ssh.password) {
      addToast(t('Complete all required SSH profile fields.'))
      return
    }
    setSaving(true)
    try {
      const id = newId('ssh')
      await AndroidNetworkTools.saveCredential({
        id,
        payload: JSON.stringify({ authType: 'password', password: ssh.password }),
      })
      update({
        sshProfiles: [
          ...networkTools.sshProfiles,
          {
            id,
            credentialId: id,
            name: ssh.name.trim(),
            host: ssh.host.trim(),
            port: ssh.port,
            username: ssh.username.trim(),
            ...(ssh.fingerprint.trim() ? { hostKeyFingerprint: ssh.fingerprint.trim() } : {}),
          },
        ],
      })
      setSsh({ name: '', host: '', port: 22, username: '', password: '', fingerprint: '' })
      addToast(t('SSH profile saved securely.'))
    } catch (error) {
      addToast(`${t('Unable to save SSH profile.')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const saveSnmp = async () => {
    const secretReady =
      snmp.version === '2c'
        ? Boolean(snmp.community)
        : Boolean(snmp.securityName && snmp.authPassphrase && snmp.privPassphrase)
    if (!snmp.name.trim() || !snmp.host.trim() || !secretReady) {
      addToast(t('Complete all required SNMP profile fields.'))
      return
    }
    setSaving(true)
    try {
      const id = newId('snmp')
      const payload =
        snmp.version === '2c'
          ? { community: snmp.community }
          : {
              securityName: snmp.securityName,
              authPassphrase: snmp.authPassphrase,
              privPassphrase: snmp.privPassphrase,
            }
      await AndroidNetworkTools.saveCredential({ id, payload: JSON.stringify(payload) })
      update({
        snmpProfiles: [
          ...networkTools.snmpProfiles,
          {
            id,
            credentialId: id,
            name: snmp.name.trim(),
            host: snmp.host.trim(),
            port: snmp.port,
            version: snmp.version,
          },
        ],
      })
      setSnmp({
        name: '',
        host: '',
        port: 161,
        version: '3',
        community: '',
        securityName: '',
        authPassphrase: '',
        privPassphrase: '',
      })
      addToast(t('SNMP profile saved securely.'))
    } catch (error) {
      addToast(`${t('Unable to save SNMP profile.')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const removeProfile = async (kind: 'ssh' | 'snmp', id: string) => {
    try {
      await AndroidNetworkTools.deleteCredential({ id })
    } catch {
      /* remove stale metadata even if secret is absent */
    }
    if (kind === 'ssh') update({ sshProfiles: networkTools.sshProfiles.filter((item) => item.id !== id) })
    else update({ snmpProfiles: networkTools.snmpProfiles.filter((item) => item.id !== id) })
  }

  return (
    <Box p="md">
      <Title order={5}>{t('Local Network Tools')}</Title>
      <Text size="sm" c="dimmed" mt="xs">
        {t(
          'These tools run directly on this Android phone and do not use MCP. Their results reflect the phone current Wi-Fi, VPN, or cellular route.',
        )}
      </Text>

      <Stack mt="xl" gap="lg">
        <Paper withBorder radius="lg" p="md">
          <Flex justify="space-between" align="center" gap="md">
            <Box>
              <Text fw={600}>{t('Enable local network tools')}</Text>
              <Text size="xs" c="dimmed">
                {t('Expose network tools to tool-capable models for automatic use.')}
              </Text>
            </Box>
            <Switch checked={networkTools.enabled} onChange={(e) => update({ enabled: e.currentTarget.checked })} />
          </Flex>
          <Flex justify="space-between" align="center" gap="md" mt="md">
            <Box>
              <Text size="sm">{t('Automatically allow read-only SSH commands')}</Text>
              <Text size="xs" c="dimmed">
                {t('All non-allowlisted SSH commands still pause for confirmation.')}
              </Text>
            </Box>
            <Switch
              checked={networkTools.sshReadOnlyAutoApproval}
              onChange={(e) => update({ sshReadOnlyAutoApproval: e.currentTarget.checked })}
            />
          </Flex>
          <NumberInput
            mt="md"
            label={t('Maximum LAN scan hosts')}
            min={1}
            max={1024}
            value={networkTools.maxLanScanHosts}
            onChange={(value) => update({ maxLanScanHosts: Number(value) || 256 })}
          />
          <NumberInput
            mt="md"
            label={t('Maximum speed test data (bytes)')}
            min={1_000_000}
            max={500_000_000}
            value={networkTools.speedTestMaxBytes}
            onChange={(value) => update({ speedTestMaxBytes: Number(value) || 25_000_000 })}
          />
          <TextInput
            mt="md"
            label={t('Speed test download URL')}
            value={networkTools.speedTestDownloadUrl}
            onChange={(e) => update({ speedTestDownloadUrl: e.currentTarget.value })}
          />
          <TextInput
            mt="md"
            label={t('Speed test upload URL')}
            value={networkTools.speedTestUploadUrl}
            onChange={(e) => update({ speedTestUploadUrl: e.currentTarget.value })}
          />
        </Paper>

        <Paper withBorder radius="lg" p="md">
          <Text fw={600}>{t('SSH Profiles')}</Text>
          <Alert mt="sm" color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
            <Text size="xs">
              {t(
                'Passwords are encrypted with Android Keystore. If the fingerprint is blank, the first SSH connection trusts and saves it automatically; later changes are rejected.',
              )}
            </Text>
          </Alert>
          <Stack mt="md" gap="sm">
            {networkTools.sshProfiles.map((profile) => (
              <Paper key={profile.id} withBorder p="sm">
                <Flex justify="space-between" align="center" gap="sm">
                  <Box>
                    <Text size="sm" fw={600}>
                      {profile.name}
                    </Text>
                    <Text size="xs" ff="monospace">
                      {profile.username}@{profile.host}:{profile.port}
                    </Text>
                  </Box>
                  <Button
                    size="compact-xs"
                    color="red"
                    variant="subtle"
                    leftSection={<IconTrash size={13} />}
                    onClick={() => void removeProfile('ssh', profile.id)}
                  >
                    {t('Delete')}
                  </Button>
                </Flex>
              </Paper>
            ))}
            <TextInput
              required
              label={t('Profile Name')}
              value={ssh.name}
              onChange={(e) => setSsh({ ...ssh, name: e.currentTarget.value })}
            />
            <TextInput
              required
              label={t('Host')}
              value={ssh.host}
              onChange={(e) => setSsh({ ...ssh, host: e.currentTarget.value })}
            />
            <NumberInput
              label={t('Port')}
              min={1}
              max={65535}
              value={ssh.port}
              onChange={(value) => setSsh({ ...ssh, port: Number(value) || 22 })}
            />
            <TextInput
              required
              label={t('Username')}
              value={ssh.username}
              onChange={(e) => setSsh({ ...ssh, username: e.currentTarget.value })}
            />
            <PasswordInput
              required
              label={t('Password')}
              value={ssh.password}
              onChange={(e) => setSsh({ ...ssh, password: e.currentTarget.value })}
            />
            <TextInput
              label={t('SSH Host Key Fingerprint')}
              placeholder="SHA256:..."
              value={ssh.fingerprint}
              onChange={(e) => setSsh({ ...ssh, fingerprint: e.currentTarget.value })}
            />
            <Button loading={saving} onClick={() => void saveSsh()}>
              {t('Add SSH Profile')}
            </Button>
          </Stack>
        </Paper>

        <Paper withBorder radius="lg" p="md">
          <Text fw={600}>{t('SNMP Profiles')}</Text>
          <Text size="xs" c="dimmed" mt={4}>
            {t('SNMPv3 authPriv is recommended. SNMP SET is not available.')}
          </Text>
          <Stack mt="md" gap="sm">
            {networkTools.snmpProfiles.map((profile) => (
              <Paper key={profile.id} withBorder p="sm">
                <Flex justify="space-between" align="center" gap="sm">
                  <Box>
                    <Text size="sm" fw={600}>
                      {profile.name}
                    </Text>
                    <Text size="xs" ff="monospace">
                      {profile.host}:{profile.port} · v{profile.version}
                    </Text>
                  </Box>
                  <Button
                    size="compact-xs"
                    color="red"
                    variant="subtle"
                    leftSection={<IconTrash size={13} />}
                    onClick={() => void removeProfile('snmp', profile.id)}
                  >
                    {t('Delete')}
                  </Button>
                </Flex>
              </Paper>
            ))}
            <TextInput
              required
              label={t('Profile Name')}
              value={snmp.name}
              onChange={(e) => setSnmp({ ...snmp, name: e.currentTarget.value })}
            />
            <TextInput
              required
              label={t('Host')}
              value={snmp.host}
              onChange={(e) => setSnmp({ ...snmp, host: e.currentTarget.value })}
            />
            <NumberInput
              label={t('Port')}
              min={1}
              max={65535}
              value={snmp.port}
              onChange={(value) => setSnmp({ ...snmp, port: Number(value) || 161 })}
            />
            <Select
              label={t('SNMP Version')}
              value={snmp.version}
              data={[
                { value: '3', label: 'SNMPv3 authPriv' },
                { value: '2c', label: 'SNMPv2c' },
              ]}
              allowDeselect={false}
              onChange={(value) => setSnmp({ ...snmp, version: value === '2c' ? '2c' : '3' })}
            />
            {snmp.version === '2c' ? (
              <PasswordInput
                required
                label={t('Community')}
                value={snmp.community}
                onChange={(e) => setSnmp({ ...snmp, community: e.currentTarget.value })}
              />
            ) : (
              <>
                <TextInput
                  required
                  label={t('Security Name')}
                  value={snmp.securityName}
                  onChange={(e) => setSnmp({ ...snmp, securityName: e.currentTarget.value })}
                />
                <PasswordInput
                  required
                  label={t('Authentication Passphrase')}
                  value={snmp.authPassphrase}
                  onChange={(e) => setSnmp({ ...snmp, authPassphrase: e.currentTarget.value })}
                />
                <PasswordInput
                  required
                  label={t('Privacy Passphrase')}
                  value={snmp.privPassphrase}
                  onChange={(e) => setSnmp({ ...snmp, privPassphrase: e.currentTarget.value })}
                />
              </>
            )}
            <Button loading={saving} onClick={() => void saveSnmp()}>
              {t('Add SNMP Profile')}
            </Button>
          </Stack>
        </Paper>
      </Stack>
    </Box>
  )
}
