import { describe, expect, it, vi } from 'vitest'

vi.mock('i18next', () => ({ t: (key: string) => key }))

import { getToolName } from './index'

describe('getToolName', () => {
  it('localizes current and legacy command tools', () => {
    expect(getToolName('run_command')).toBe('Run Command')
    expect(getToolName('user_exec')).toBe('Run Command')
  })

  it.each([
    [{ argv: ['version'] }, 'Chatbox Version'],
    [{ argv: ['account', 'status'] }, 'Account Status'],
    [{ argv: ['account', 'license'] }, 'License Details'],
    [{ argv: ['account', 'quota'] }, 'Quota Details'],
    [{ argv: ['account', 'refresh'] }, 'Refresh Account Status'],
    [{ argv: ['settings', 'list'] }, 'List Settings'],
    [{ command: 'chatbox settings get appearance.theme' }, 'Read Setting'],
    [{ argv: ['chats', 'list', '--limit', '10'] }, 'Conversation List'],
    [{ argv: ['chats', 'search', 'release notes'] }, 'Search All Conversations'],
    [{ argv: ['chats', 'read', 'session-1'] }, 'Read Conversation'],
    [{ argv: ['image', 'models'] }, 'List Image Models'],
    [{ command: 'chatbox image generate --prompt "a red fox"' }, 'Generate images'],
    [{ argv: ['image', 'status', 'record-1'] }, 'Image Generation Status'],
    [{ argv: ['image', 'history'] }, 'Image History'],
  ])('shows a command-specific Chatbox CLI name for %j', (input, expected) => {
    expect(getToolName('chatbox_cli', input)).toBe(expected)
  })

  it('supports legacy account aliases and safe fallback names', () => {
    expect(getToolName('chatbox_cli', { argv: ['quota'] })).toBe('Quota Details')
    expect(getToolName('chatbox_cli', { argv: ['license', 'refresh'] })).toBe('Refresh Account Status')
    expect(getToolName('chatbox_cli', { argv: ['help'] })).toBe('Chatbox')
    expect(getToolName('chatbox_cli', { command: '"unterminated' })).toBe('Chatbox')
  })

  it('shows the actually loaded Skill and called MCP server/tool', () => {
    expect(getToolName('load_skill', { name: 'document-review' })).toBe('Skill · document-review')
    expect(getToolName('mcp__search-server__web_search', { query: 'test' })).toBe('MCP · search-server · web_search')
  })

  it('uses a localized display name for image search', () => {
    expect(getToolName('image_search')).toBe('Image Search')
    expect(getToolName('video_search')).toBe('Video Search')
    expect(getToolName('create_threejs_animation')).toBe('Interactive Animation')
  })

  it('uses localized names for local network tools', () => {
    expect(getToolName('net_info')).toBe('Network Information')
    expect(getToolName('tcp_ping')).toBe('TCP Ping')
    expect(getToolName('ssh')).toBe('SSH Command')
    expect(getToolName('snmp_walk')).toBe('SNMP Walk')
  })
})
