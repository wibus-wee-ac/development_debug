// Input: node:fs/promises temp skill directories, mocked bundled resource path
// Output: Regression tests for filesystem-based skills inventory, CRUD, import/export, and five-layer root precedence
// Position: Unit test file for src/main/lib/skills.ts

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SkillCatalogEntry } from '../skills'
import {
  createSkillDocument,
  deleteSkillDocument,
  exportSkillPackage,
  importSkillPackage,
  listSkillInventory,
  readSkillDocument,
  scanSkills,
  updateSkillDocument,
} from '../skills'

const { getBundledResourcePath } = vi.hoisted(() => ({
  getBundledResourcePath: vi.fn<(relativePath: string) => string>(),
}))

vi.mock('../bundled-resources', () => ({
  getBundledResourcePath,
}))

async function writeSkillPackage(
  rootDir: string,
  folderName: string,
  frontmatter: Record<string, unknown>,
  body = '# Skill\n',
): Promise<void> {
  const skillDir = join(rootDir, folderName)
  await mkdir(skillDir, { recursive: true })
  const yamlLines = Object.entries(frontmatter).map(([key, value]) => {
    if (typeof value === 'string') {
      return `${key}: ${value}`
    }
    return `${key}: ${JSON.stringify(value)}`
  })
  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---\n${yamlLines.join('\n')}\n---\n\n${body}`,
    'utf8',
  )
}

function mapByName(entries: SkillCatalogEntry[]): Record<string, SkillCatalogEntry> {
  return Object.fromEntries(entries.map(entry => [entry.name, entry]))
}

describe('skills library', () => {
  let sandboxDir: string
  let homeDir: string
  let builtinDir: string
  let workspaceDir: string
  let legacyDir: string
  let sharedDir: string
  let homedirSpy: ReturnType<typeof vi.spyOn>
  const agentId = 'agent-123'

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(os.tmpdir(), 'cradle-skills-test-'))
    homeDir = join(sandboxDir, 'home')
    builtinDir = join(sandboxDir, 'builtin')
    workspaceDir = join(sandboxDir, 'workspace')
    legacyDir = join(homeDir, '.agents', 'skills')
    sharedDir = join(homeDir, '.cradle', 'skills')
    await mkdir(legacyDir, { recursive: true })
    await mkdir(sharedDir, { recursive: true })
    await mkdir(join(homeDir, '.cradle', 'agents', agentId, 'skills'), { recursive: true })
    await mkdir(builtinDir, { recursive: true })
    await mkdir(join(workspaceDir, '.agents', 'skills'), { recursive: true })

    getBundledResourcePath.mockReturnValue(builtinDir)
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir)
  })

  afterEach(async () => {
    homedirSpy.mockRestore()
    vi.clearAllMocks()
    await rm(sandboxDir, { recursive: true, force: true })
  })

  it('scans built-in, legacy, shared, workspace, and agent skills with agent override priority', async () => {
    await writeSkillPackage(builtinDir, 'alpha', {
      name: 'alpha',
      description: 'builtin alpha',
    })
    await writeSkillPackage(legacyDir, 'alpha-legacy', {
      name: 'alpha',
      description: 'legacy alpha',
    })
    await writeSkillPackage(sharedDir, 'alpha-global', {
      name: 'alpha',
      description: 'global alpha',
    })
    await writeSkillPackage(join(workspaceDir, '.agents', 'skills'), 'alpha-workspace', {
      name: 'alpha',
      description: 'workspace alpha',
    })
    await writeSkillPackage(join(homeDir, '.cradle', 'agents', agentId, 'skills'), 'alpha-agent', {
      name: 'alpha',
      description: 'agent alpha',
    })
    await writeSkillPackage(sharedDir, 'beta', {
      name: 'beta',
      description: 'global beta',
    })

    const entries = scanSkills({ workspacePath: workspaceDir, agentId })
    const byName = mapByName(entries)

    expect(Object.keys(byName).sort()).toEqual(['alpha', 'beta'])
    expect(byName.alpha).toMatchObject({
      description: 'agent alpha',
      scope: 'agent',
    })
    expect(byName.beta).toMatchObject({
      description: 'global beta',
      scope: 'global',
    })
  })

  it('lists inventory entries with active flags across all scopes', async () => {
    await writeSkillPackage(builtinDir, 'alpha', {
      name: 'alpha',
      description: 'builtin alpha',
    })
    await writeSkillPackage(legacyDir, 'alpha-legacy', {
      name: 'alpha',
      description: 'legacy alpha',
    })
    await writeSkillPackage(sharedDir, 'alpha-global', {
      name: 'alpha',
      description: 'global alpha',
    })
    await writeSkillPackage(join(workspaceDir, '.agents', 'skills'), 'beta', {
      name: 'beta',
      description: 'workspace beta',
    })

    const entries = listSkillInventory({ workspacePath: workspaceDir })
    const alphaEntries = entries.filter(entry => entry.name === 'alpha')
    const betaEntries = entries.filter(entry => entry.name === 'beta')

    expect(alphaEntries).toHaveLength(3)
    expect(alphaEntries.some(entry => entry.scope === 'global' && entry.active)).toBe(true)
    expect(alphaEntries.some(entry => entry.scope === 'legacy' && !entry.active && entry.shadowedBy === 'global')).toBe(true)
    expect(alphaEntries.some(entry => entry.scope === 'builtin' && !entry.active && entry.shadowedBy === 'global')).toBe(true)
    expect(betaEntries).toEqual([
      expect.objectContaining({
        name: 'beta',
        scope: 'workspace',
        active: true,
      }),
    ])
  })

  it('creates, updates, and deletes a global skill while preserving unknown frontmatter', async () => {
    await createSkillDocument('global', {
      name: 'global-skill',
      description: 'first version',
      body: '# Hello\n',
    })

    const created = await readSkillDocument({
      scope: 'global',
      name: 'global-skill',
    })
    expect(created).toMatchObject({
      name: 'global-skill',
      description: 'first version',
      body: '# Hello\n',
    })

    const importedDir = join(sandboxDir, 'import-source')
    await writeSkillPackage(importedDir, 'preserved', {
      name: 'preserved-skill',
      description: 'imported',
      version: '1.2.3',
    }, '# Imported\n')

    await importSkillPackage('global', {
      sourceDir: join(importedDir, 'preserved'),
      overwrite: false,
    })

    await updateSkillDocument({
      scope: 'global',
      name: 'preserved-skill',
      document: {
        name: 'preserved-skill',
        description: 'updated',
        body: '# Updated\n',
      },
    })

    const updated = await readSkillDocument({
      scope: 'global',
      name: 'preserved-skill',
    })

    expect(updated.description).toBe('updated')
    expect(updated.body).toBe('# Updated\n')
    expect(updated.frontmatter.version).toBe('1.2.3')

    await deleteSkillDocument({
      scope: 'global',
      name: 'global-skill',
    })

    await expect(readSkillDocument({
      scope: 'global',
      name: 'global-skill',
    })).rejects.toThrow(/Skill not found/)
  })

  it('creates agent-private skills under ~/.cradle/agents/{agentId}/skills', async () => {
    const created = await createSkillDocument('agent', {
      agentId,
      name: 'agent-only',
      description: 'agent private skill',
      body: '# Agent\n',
    })

    expect(created.rootDir).toBe(join(homeDir, '.cradle', 'agents', agentId, 'skills'))
    expect(created.location).toBe(join(homeDir, '.cradle', 'agents', agentId, 'skills', 'agent-only', 'SKILL.md'))

    const entries = scanSkills({ workspacePath: workspaceDir, agentId })
    expect(entries).toContainEqual(expect.objectContaining({
      name: 'agent-only',
      scope: 'agent',
    }))
  })

  it('imports and exports skill packages with nested files intact', async () => {
    const sourceRoot = join(sandboxDir, 'source-root')
    const exportRoot = join(sandboxDir, 'export-root')
    const sourceDir = join(sourceRoot, 'demo-skill')

    await writeSkillPackage(sourceRoot, 'demo-skill', {
      name: 'demo-skill',
      description: 'demo import',
    }, '# Demo\n')
    await mkdir(join(sourceDir, 'references'), { recursive: true })
    await writeFile(join(sourceDir, 'references', 'usage.md'), 'usage', 'utf8')

    const imported = await importSkillPackage('workspace', {
      sourceDir,
      workspacePath: workspaceDir,
      overwrite: false,
    })

    expect(imported.scope).toBe('workspace')
    expect(imported.name).toBe('demo-skill')

    const exportedDir = await exportSkillPackage({
      scope: 'workspace',
      name: 'demo-skill',
      workspacePath: workspaceDir,
      destinationDir: exportRoot,
      overwrite: false,
    })

    const exportedContent = await readFile(join(exportedDir, 'references', 'usage.md'), 'utf8')
    expect(exportedContent).toBe('usage')
  })

  it('rejects writes to legacy read-only skills', async () => {
    await expect(createSkillDocument('legacy', {
      name: 'legacy-write',
      description: 'nope',
      body: '# Nope\n',
    })).rejects.toThrow(/read-only/i)
  })
})
