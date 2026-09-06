import { registerPlugin } from '@capacitor/core'

export interface AndroidNetworkToolsPlugin {
  getNetworkInfo(): Promise<Record<string, unknown>>
  ping(options: Record<string, unknown>): Promise<Record<string, unknown>>
  tcpPing(options: Record<string, unknown>): Promise<Record<string, unknown>>
  dnsLookup(options: Record<string, unknown>): Promise<Record<string, unknown>>
  httpProbe(options: Record<string, unknown>): Promise<Record<string, unknown>>
  mdnsDiscover(options: Record<string, unknown>): Promise<Record<string, unknown>>
  lanScan(options: Record<string, unknown>): Promise<Record<string, unknown>>
  wifiScan(options: Record<string, unknown>): Promise<Record<string, unknown>>
  speedTest(options: Record<string, unknown>): Promise<Record<string, unknown>>
  sshExec(options: Record<string, unknown>): Promise<Record<string, unknown>>
  snmpGet(options: Record<string, unknown>): Promise<Record<string, unknown>>
  snmpWalk(options: Record<string, unknown>): Promise<Record<string, unknown>>
  saveCredential(options: { id: string; payload: string }): Promise<{ saved: boolean }>
  deleteCredential(options: { id: string }): Promise<{ deleted: boolean }>
}

export const AndroidNetworkTools = registerPlugin<AndroidNetworkToolsPlugin>('NetworkTools')
