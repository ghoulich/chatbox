import { beforeEach, describe, expect, it, vi } from 'vitest'

const { scanSkillDirectory } = vi.hoisted(() => ({ scanSkillDirectory: vi.fn() }))

vi.mock('@/platform/android_document_saver', () => ({
  AndroidDocumentSaver: { scanSkillDirectory },
}))

import { clearMobileSkillsCache, discoverMobileSkills, loadMobileSkill, scanMobileSkills } from './mobile-directory'

describe('mobile Skills directory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearMobileSkillsCache()
  })

  it('parses recursive SKILL.md results and loads the prompt body', async () => {
    scanSkillDirectory.mockResolvedValue({
      files: [
        {
          path: 'research/SKILL.md',
          content: '---\nname: research\ndescription: Research with trusted sources\n---\nUse the MCP search tool.',
        },
      ],
    })

    const result = await scanMobileSkills('content://skills')
    expect(result.skills.map((skill) => skill.name)).toEqual(['network-operations', 'research'])
    expect(await loadMobileSkill('content://skills', 'research')).toMatchObject({
      body: 'Use the MCP search tool.',
      files: [],
    })
    expect(scanSkillDirectory).toHaveBeenCalledTimes(1)
  })

  it('parses Skills when the WebView does not provide a global Buffer', async () => {
    const originalBuffer = globalThis.Buffer
    // @ts-expect-error Simulate the Capacitor WebView rather than the Node test runtime.
    delete globalThis.Buffer
    scanSkillDirectory.mockResolvedValue({
      files: [
        {
          path: 'mobile/SKILL.md',
          content: '---\nname: mobile\ndescription: Runs in a WebView\n---\nMobile prompt.',
        },
      ],
    })

    try {
      const result = await scanMobileSkills('content://skills')
      expect(result.errors).toEqual([])
      expect(result.skills.map((skill) => skill.name)).toContain('mobile')
    } finally {
      globalThis.Buffer = originalBuffer
    }
  })

  it('reports malformed and duplicate skills without exposing them', async () => {
    scanSkillDirectory.mockResolvedValue({
      files: [
        { path: 'bad/SKILL.md', content: '---\nname: Bad Name\ndescription: invalid\n---\nbody' },
        { path: 'one/SKILL.md', content: '---\nname: same\ndescription: first\n---\none' },
        { path: 'two/SKILL.md', content: '---\nname: same\ndescription: second\n---\ntwo' },
      ],
      truncated: true,
    })

    const result = await scanMobileSkills('content://skills')
    expect(result.skills.map((skill) => skill.name)).toEqual(['network-operations', 'same'])
    expect(result.errors).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('keeps the bundled network operations Skill when no directory is configured', async () => {
    scanSkillDirectory.mockResolvedValue({ files: [] })
    await scanMobileSkills('content://skills')
    expect(await discoverMobileSkills()).toMatchObject([
      { name: 'network-operations', isBuiltin: true, path: 'builtin://network-operations/SKILL.md' },
    ])
    expect(await loadMobileSkill(undefined, 'network-operations')).toMatchObject({
      body: expect.stringContaining('dns_lookup'),
    })
  })

  it('re-scans a configured directory to detect files copied from a computer', async () => {
    scanSkillDirectory.mockResolvedValue({ files: [] })
    await discoverMobileSkills('content://skills')
    await discoverMobileSkills('content://skills')
    expect(scanSkillDirectory).toHaveBeenCalledTimes(2)
  })
})
