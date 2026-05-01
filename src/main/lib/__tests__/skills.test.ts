// Input: node:fs/promises temp skill directories, mocked bundled resource path
// Output: Regression tests for filesystem-based skills inventory, CRUD, import/export, and agent skill selection
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
  parseAgentSkillConfig,
  readSkillDocument,
  scanSkills,
  selectSkillCatalogEntries,
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
  let homedirSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(os.tmpdir(), 'cradle-skills-test-'))
    homeDir = join(sandboxDir, 'home')
    builtinDir = join(sandboxDir, 'builtin')
    workspaceDir = join(sandboxDir, 'workspace')
    await mkdir(join(homeDir, '.agents', 'skills'), { recursive: true })
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

  it('scans built-in, global, and workspace skills with workspace override priority', async () => {
    await writeSkillPackage(builtinDir, 'alpha', {
      name: 'alpha',
      description: 'builtin alpha',
    })
    await writeSkillPackage(join(homeDir, '.agents', 'skills'), 'alpha-global', {
      name: 'alpha',
      description: 'global alpha',
    })
    await writeSkillPackage(join(workspaceDir, '.agents', 'skills'), 'alpha-workspace', {
      name: 'alpha',
      description: 'workspace alpha',
    })
    await writeSkillPackage(join(homeDir, '.agents', 'skills'), 'beta', {
      name: 'beta',
      description: 'global beta',
    })

    const entries = scanSkills(workspaceDir)
    const byName = mapByName(entries)

    expect(Object.keys(byName).sort()).toEqual(['alpha', 'beta'])
    expect(byName.alpha).toMatchObject({
      description: 'workspace alpha',
      scope: 'workspace',
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
    await writeSkillPackage(join(homeDir, '.agents', 'skills'), 'alpha-global', {
      name: 'alpha',
      description: 'global alpha',
    })
    await writeSkillPackage(join(workspaceDir, '.agents', 'skills'), 'beta', {
      name: 'beta',
      description: 'workspace beta',
    })

    const entries = listSkillInventory(workspaceDir)
    const alphaEntries = entries.filter(entry => entry.name === 'alpha')
    const betaEntries = entries.filter(entry => entry.name === 'beta')

    expect(alphaEntries).toHaveLength(2)
    expect(alphaEntries.some(entry => entry.scope === 'global' && entry.active)).toBe(true)
    expect(alphaEntries.some(entry => entry.scope === 'builtin' && !entry.active)).toBe(true)
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
      workspacePath: workspaceDir,
    })

    const created = await readSkillDocument({
      scope: 'global',
      name: 'global-skill',
      workspacePath: workspaceDir,
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
      workspacePath: workspaceDir,
      overwrite: false,
    })

    await updateSkillDocument({
      scope: 'global',
      name: 'preserved-skill',
      workspacePath: workspaceDir,
      document: {
        name: 'preserved-skill',
        description: 'updated',
        body: '# Updated\n',
      },
    })

    const updated = await readSkillDocument({
      scope: 'global',
      name: 'preserved-skill',
      workspacePath: workspaceDir,
    })

    expect(updated.description).toBe('updated')
    expect(updated.body).toBe('# Updated\n')
    expect(updated.frontmatter.version).toBe('1.2.3')

    await deleteSkillDocument({
      scope: 'global',
      name: 'global-skill',
      workspacePath: workspaceDir,
    })

    await expect(readSkillDocument({
      scope: 'global',
      name: 'global-skill',
      workspacePath: workspaceDir,
    })).rejects.toThrow(/Skill not found/)
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

  it('filters the injected catalog by agent skill references', () => {
    const entries: SkillCatalogEntry[] = [
      {
        name: 'builtin-skill',
        description: 'builtin',
        location: '/builtin/builtin-skill/SKILL.md',
        scope: 'builtin',
        rootDir: '/builtin',
        skillDir: '/builtin/builtin-skill',
      },
      {
        name: 'global-skill',
        description: 'global',
        location: '/global/global-skill/SKILL.md',
        scope: 'global',
        rootDir: '/global',
        skillDir: '/global/global-skill',
      },
      {
        name: 'workspace-skill',
        description: 'workspace',
        location: '/workspace/workspace-skill/SKILL.md',
        scope: 'workspace',
        rootDir: '/workspace',
        skillDir: '/workspace/workspace-skill',
      },
    ]

    expect(selectSkillCatalogEntries(entries, {
      mode: 'inherit',
      selected: [],
    })).toHaveLength(3)

    expect(selectSkillCatalogEntries(entries, {
      mode: 'selected',
      selected: [
        { scope: 'global', name: 'global-skill' },
        { scope: 'workspace', name: 'missing-skill' },
      ],
    })).toEqual([
      expect.objectContaining({
        name: 'global-skill',
        scope: 'global',
      }),
    ])
  })

  it('parses agent skill config from agent configJson', () => {
    expect(parseAgentSkillConfig()).toEqual({
      mode: 'inherit',
      selected: [],
    })

    expect(parseAgentSkillConfig(JSON.stringify({
      systemPrompt: 'hello',
      skills: {
        mode: 'selected',
        selected: [
          { scope: 'global', name: 'global-skill' },
          { scope: 'invalid', name: 'ignored' },
        ],
      },
    }))).toEqual({
      mode: 'selected',
      selected: [
        { scope: 'global', name: 'global-skill' },
      ],
    })
  })
})
