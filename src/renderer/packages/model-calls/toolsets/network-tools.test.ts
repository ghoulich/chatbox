import { beforeEach, describe, expect, it, vi } from 'vitest'

const { native, approval, state, settingsSet } = vi.hoisted(() => ({
  native: {
    getNetworkInfo: vi.fn(),
    ping: vi.fn(),
    tcpPing: vi.fn(),
    dnsLookup: vi.fn(),
    httpProbe: vi.fn(),
    mdnsDiscover: vi.fn(),
    lanScan: vi.fn(),
    wifiScan: vi.fn(),
    speedTest: vi.fn(),
    sshExec: vi.fn(),
    snmpGet: vi.fn(),
    snmpWalk: vi.fn(),
  },
  approval: vi.fn(),
  state: {
    enabled: true,
    sshReadOnlyAutoApproval: true,
    maxLanScanHosts: 256,
    speedTestMaxBytes: 25_000_000,
    speedTestDownloadUrl: 'https://speed.example/down',
    speedTestUploadUrl: 'https://speed.example/up',
    sshProfiles: [
      { id: 'nas', name: 'NAS', host: '192.168.1.10', port: 22, username: 'admin', credentialId: 'ssh-secret' },
    ],
    snmpProfiles: [
      {
        id: 'switch',
        name: 'Switch',
        host: '192.168.1.2',
        port: 161,
        version: '3' as const,
        credentialId: 'snmp-secret',
      },
    ],
  },
  settingsSet: vi.fn(),
}))

vi.mock('@/platform/android_network_tools', () => ({ AndroidNetworkTools: native }))
vi.mock('@/packages/user-exec-approval', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/user-exec-approval')>()),
  requestUserExecApproval: approval,
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ networkTools: state, setSettings: settingsSet }) },
}))

import { buildNetworkTools, getNetworkToolsInstruction } from './network-tools'

const toolOptions = { toolCallId: 'call-1', messages: [], abortSignal: undefined }

describe('local network toolset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    approval.mockResolvedValue('whitelist')
  })

  it('exposes the complete local operations surface and profile context', () => {
    const tools = buildNetworkTools()
    expect(Object.keys(tools)).toEqual([
      'net_info',
      'ping',
      'tcp_ping',
      'dns_lookup',
      'http_probe',
      'mdns_discover',
      'lan_scan',
      'wifi_scan',
      'speedtest',
      'ssh',
      'snmp_get',
      'snmp_walk',
    ])
    expect(getNetworkToolsInstruction()).toContain('NAS: admin@192.168.1.10:22')
    expect(getNetworkToolsInstruction()).toContain('do not use MCP')
  })

  it('bounds LAN scans with the configured host limit', async () => {
    native.lanScan.mockResolvedValue({ hosts: [] })
    await buildNetworkTools().lan_scan.execute?.({ cidr: '192.168.1.0/24' }, toolOptions)
    expect(native.lanScan).toHaveBeenCalledWith({ cidr: '192.168.1.0/24', maxHosts: 256 })
  })

  it('checks SSH approval and resolves secrets by profile instead of model input', async () => {
    native.sshExec.mockResolvedValue({ exitStatus: 0, stdout: 'ok' })
    await buildNetworkTools().ssh.execute?.({ profileId: 'nas', command: 'df -h' }, toolOptions)
    expect(approval).toHaveBeenCalledWith('call-1', 'df -h', undefined, undefined)
    expect(native.sshExec).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'nas',
        credentialId: 'ssh-secret',
        command: 'df -h',
        host: '192.168.1.10',
      }),
    )
  })

  it.each([
    ['trusted-on-first-use', 'first-use'],
    ['saved', 'previously-saved'],
  ])('writes a %s native host key back to the saved SSH profile', async (hostKeyTrust, fingerprintSuffix) => {
    native.sshExec.mockResolvedValue({
      exitStatus: 0,
      stdout: 'ok',
      hostKeyFingerprint: `SHA256:${fingerprintSuffix}-key`,
      hostKeyTrust,
    })
    await buildNetworkTools().ssh.execute?.({ profileId: 'nas', command: 'df -h' }, toolOptions)

    expect(settingsSet).toHaveBeenCalledOnce()
    const updater = settingsSet.mock.calls[0][0]
    const draft = {
      networkTools: { ...state, sshProfiles: state.sshProfiles.map((profile) => ({ ...profile })) },
    }
    updater(draft)
    expect(draft.networkTools.sshProfiles[0]).toMatchObject({
      hostKeyFingerprint: `SHA256:${fingerprintSuffix}-key`,
    })
  })

  it('does not expose SNMP SET and caps walk inputs through the schema', () => {
    const tools = buildNetworkTools()
    expect(tools).not.toHaveProperty('snmp_set')
    expect(JSON.stringify(tools.snmp_walk.inputSchema)).toContain('200')
  })
})
