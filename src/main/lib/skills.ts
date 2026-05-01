// Input: node:fs, node:fs/promises, node:path, node:os, js-yaml, bundled resources
// Output: Filesystem-backed skills catalog scanning, CRUD, import/export, and agent-level selection helpers
// Position: Main-process library for skill package discovery and management across built-in, global, and workspace scopes

import fs from 'node:fs'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import yaml from 'js-yaml'

import { getBundledResourcePath } from './bundled-resources'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const UNSAFE_PATH_RE = /[/\\]|\.\./
const SKILLS_DIR_PARTS = ['.agents', 'skills'] as const

const SCOPE_PRIORITY: Record<SkillScope, number> = {
  builtin: 0,
  global: 1,
  workspace: 2,
}

export type SkillScope = 'builtin' | 'global' | 'workspace'

export interface SkillCatalogEntry {
  name: string
  description: string
  location: string
  scope: SkillScope
  rootDir: string
  skillDir: string
}

export interface SkillInventoryEntry extends SkillCatalogEntry {
  active: boolean
  shadowedBy: SkillScope | null
}

export interface SkillDocument {
  name: string
  description: string
  body: string
  frontmatter: Record<string, unknown>
  location: string
  scope: SkillScope
  rootDir: string
  skillDir: string
}

export interface AgentSkillReference {
  scope: SkillScope
  name: string
}

export interface AgentSkillConfig {
  mode?: 'inherit' | 'selected'
  selected?: AgentSkillReference[]
}

export interface CreateSkillInput {
  name: string
  description: string
  body: string
  workspacePath?: string
  frontmatter?: Record<string, unknown>
}

export interface UpdateSkillInput {
  scope: SkillScope
  name: string
  workspacePath?: string
  document: {
    name: string
    description: string
    body: string
    frontmatter?: Record<string, unknown>
  }
}

export interface SkillLookup {
  scope: SkillScope
  name: string
  workspacePath?: string
}

export interface ImportSkillInput {
  sourceDir: string
  workspacePath?: string
  overwrite?: boolean
}

export interface ExportSkillInput extends SkillLookup {
  destinationDir: string
  overwrite?: boolean
}

interface ParsedSkillDocument {
  frontmatter: Record<string, unknown>
  name: string
  description: string
  body: string
}

interface ScopeScanResult {
  scope: SkillScope
  entries: SkillCatalogEntry[]
}

/**
 * Scan skills directories for SKILL.md files.
 * Priority (lowest to highest): built-in → user-level → project-level.
 * Same-named skills are overwritten by higher-priority sources.
 */
export function scanSkills(workspacePath?: string): SkillCatalogEntry[] {
  const inventory = listSkillInventory(workspacePath)
  return inventory.filter(entry => entry.active)
}

export function listSkillInventory(workspacePath?: string): SkillInventoryEntry[] {
  const scopedEntries = scanAllScopes(workspacePath)
  const activeScopeByName = new Map<string, SkillScope>()

  for (const { entries } of scopedEntries) {
    for (const entry of entries) {
      const current = activeScopeByName.get(entry.name)
      if (!current || SCOPE_PRIORITY[entry.scope] >= SCOPE_PRIORITY[current]) {
        activeScopeByName.set(entry.name, entry.scope)
      }
    }
  }

  return scopedEntries.flatMap(({ entries }) => entries.map((entry) => {
    const activeScope = activeScopeByName.get(entry.name) ?? null
    return {
      ...entry,
      active: activeScope === entry.scope,
      shadowedBy: activeScope === entry.scope ? null : activeScope,
    }
  }))
}

export async function readSkillDocument(input: SkillLookup): Promise<SkillDocument> {
  const entry = resolveInventoryEntry(input)
  const content = await readFile(entry.location, 'utf8')
  const parsed = parseSkillDocument(content)
  return toSkillDocument(entry, parsed)
}

export async function createSkillDocument(scope: SkillScope, input: CreateSkillInput): Promise<SkillDocument> {
  assertWritableScope(scope)
  assertSkillName(input.name)
  const rootDir = resolveScopeRoot(scope, input.workspacePath)
  const skillDir = path.join(rootDir, toSkillDirName(input.name))

  if (fs.existsSync(skillDir)) {
    throw new Error(`Skill directory already exists: ${skillDir}`)
  }

  await mkdir(skillDir, { recursive: true })
  const frontmatter = {
    ...(input.frontmatter ?? {}),
    name: input.name,
    description: input.description,
  }
  const skillPath = path.join(skillDir, 'SKILL.md')
  await writeFile(skillPath, serializeSkillDocument(frontmatter, input.body), 'utf8')

  return {
    name: input.name,
    description: input.description,
    body: input.body,
    frontmatter,
    location: skillPath,
    scope,
    rootDir,
    skillDir,
  }
}

export async function updateSkillDocument(input: UpdateSkillInput): Promise<SkillDocument> {
  assertWritableScope(input.scope)
  assertSkillName(input.document.name)
  const existing = await readSkillDocument({
    scope: input.scope,
    name: input.name,
    workspacePath: input.workspacePath,
  })

  const nextFrontmatter = {
    ...existing.frontmatter,
    ...(input.document.frontmatter ?? {}),
    name: input.document.name,
    description: input.document.description,
  }

  const targetRootDir = existing.rootDir
  const targetSkillDir = path.join(targetRootDir, toSkillDirName(input.document.name))
  if (targetSkillDir !== existing.skillDir && fs.existsSync(targetSkillDir)) {
    throw new Error(`Target skill directory already exists: ${targetSkillDir}`)
  }

  if (targetSkillDir !== existing.skillDir) {
    await rename(existing.skillDir, targetSkillDir)
  }

  const targetLocation = path.join(targetSkillDir, 'SKILL.md')
  await writeFile(targetLocation, serializeSkillDocument(nextFrontmatter, input.document.body), 'utf8')

  return {
    name: input.document.name,
    description: input.document.description,
    body: input.document.body,
    frontmatter: nextFrontmatter,
    location: targetLocation,
    scope: input.scope,
    rootDir: targetRootDir,
    skillDir: targetSkillDir,
  }
}

export async function deleteSkillDocument(input: SkillLookup): Promise<void> {
  assertWritableScope(input.scope)
  const entry = resolveInventoryEntry(input)
  await rm(entry.skillDir, { recursive: true, force: true })
}

export async function importSkillPackage(scope: SkillScope, input: ImportSkillInput): Promise<SkillDocument> {
  assertWritableScope(scope)
  const sourceSkillPath = path.join(input.sourceDir, 'SKILL.md')
  const content = await readFile(sourceSkillPath, 'utf8')
  const parsed = parseSkillDocument(content)
  assertSkillName(parsed.name)

  const rootDir = resolveScopeRoot(scope, input.workspacePath)
  const targetDir = path.join(rootDir, toSkillDirName(parsed.name))

  if (fs.existsSync(targetDir)) {
    if (!input.overwrite) {
      throw new Error(`Skill already exists: ${parsed.name}`)
    }
    await rm(targetDir, { recursive: true, force: true })
  }

  await mkdir(rootDir, { recursive: true })
  await cp(input.sourceDir, targetDir, { recursive: true })

  return {
    name: parsed.name,
    description: parsed.description,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    location: path.join(targetDir, 'SKILL.md'),
    scope,
    rootDir,
    skillDir: targetDir,
  }
}

export async function exportSkillPackage(input: ExportSkillInput): Promise<string> {
  const entry = resolveInventoryEntry(input)
  const destination = path.join(input.destinationDir, path.basename(entry.skillDir))

  if (fs.existsSync(destination)) {
    if (!input.overwrite) {
      throw new Error(`Export destination already exists: ${destination}`)
    }
    await rm(destination, { recursive: true, force: true })
  }

  await mkdir(input.destinationDir, { recursive: true })
  await cp(entry.skillDir, destination, { recursive: true })
  return destination
}

export function selectSkillCatalogEntries(
  entries: SkillCatalogEntry[],
  config?: AgentSkillConfig | null,
): SkillCatalogEntry[] {
  if (!config || config.mode !== 'selected') {
    return entries
  }

  const wanted = new Set((config.selected ?? []).map(ref => `${ref.scope}:${ref.name}`))
  return entries.filter(entry => wanted.has(`${entry.scope}:${entry.name}`))
}

/**
 * Build a skill catalog text block for injection into system prompts.
 */
export function buildSkillCatalog(entries: SkillCatalogEntry[]): string {
  if (entries.length === 0) {
    return ''
  }
  const lines = entries.map(e => `- ${e.name}: ${e.description} [${e.location}]`)
  return `\nAvailable skills (read the SKILL.md file at the listed path when the task matches):\n${lines.join('\n')}`
}

function scanAllScopes(workspacePath?: string): ScopeScanResult[] {
  const results: ScopeScanResult[] = []
  const builtinRoot = resolveScopeRoot('builtin', workspacePath)
  results.push({
    scope: 'builtin',
    entries: scanDirectory(builtinRoot, 'builtin'),
  })

  const globalRoot = resolveScopeRoot('global', workspacePath)
  results.push({
    scope: 'global',
    entries: scanDirectory(globalRoot, 'global'),
  })

  if (workspacePath) {
    const workspaceRoot = resolveScopeRoot('workspace', workspacePath)
    results.push({
      scope: 'workspace',
      entries: scanDirectory(workspaceRoot, 'workspace'),
    })
  }

  return results
}

function scanDirectory(rootDir: string, scope: SkillScope): SkillCatalogEntry[] {
  if (!fs.existsSync(rootDir)) {
    return []
  }

  let dirEntries: fs.Dirent[]
  try {
    dirEntries = fs.readdirSync(rootDir, { withFileTypes: true })
  }
  catch {
    return []
  }

  const result: SkillCatalogEntry[] = []
  for (const dirEntry of dirEntries) {
    if (!dirEntry.isDirectory()) {
      continue
    }

    const skillDir = path.join(rootDir, dirEntry.name)
    const skillPath = path.join(skillDir, 'SKILL.md')
    if (!fs.existsSync(skillPath)) {
      continue
    }

    try {
      const parsed = parseSkillDocument(fs.readFileSync(skillPath, 'utf8'))
      result.push({
        name: parsed.name,
        description: parsed.description,
        location: skillPath,
        scope,
        rootDir,
        skillDir,
      })
    }
    catch {
      // Malformed skill package — skip
    }
  }

  return result
}

function resolveInventoryEntry(input: SkillLookup): SkillCatalogEntry {
  const entries = listSkillInventory(input.workspacePath)
  const match = entries.find(entry => entry.scope === input.scope && entry.name === input.name)
  if (!match) {
    throw new Error(`Skill not found: ${input.scope}:${input.name}`)
  }
  return match
}

function resolveScopeRoot(scope: SkillScope, workspacePath?: string): string {
  switch (scope) {
    case 'builtin':
      return getBundledResourcePath('skills')
    case 'global':
      return path.join(os.homedir(), ...SKILLS_DIR_PARTS)
    case 'workspace':
      if (!workspacePath) {
        throw new Error('workspacePath is required for workspace skills')
      }
      return path.join(workspacePath, ...SKILLS_DIR_PARTS)
  }
}

function assertWritableScope(scope: SkillScope): void {
  if (scope === 'builtin') {
    throw new Error('Built-in skills are read-only')
  }
}

function assertSkillName(name: string): void {
  if (!name.trim()) {
    throw new Error('Skill name is required')
  }
}

function parseSkillDocument(content: string): ParsedSkillDocument {
  const match = content.match(FRONTMATTER_RE)
  if (!match) {
    throw new Error('SKILL.md is missing YAML frontmatter')
  }

  const raw = yaml.load(match[1]) as Record<string, unknown> | null
  const frontmatter = raw && typeof raw === 'object' ? { ...raw } : {}
  const name = typeof frontmatter.name === 'string' ? frontmatter.name : ''
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : ''
  if (!name || !description) {
    throw new Error('SKILL.md frontmatter must contain name and description')
  }

  return {
    frontmatter,
    name,
    description,
    body: content.slice(match[0].length).replace(/^\r?\n/, ''),
  }
}

function serializeSkillDocument(frontmatter: Record<string, unknown>, body: string): string {
  const yamlBlock = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }).trimEnd()

  return `---\n${yamlBlock}\n---\n\n${body}`
}

function toSkillDocument(entry: SkillCatalogEntry, parsed: ParsedSkillDocument): SkillDocument {
  return {
    name: parsed.name,
    description: parsed.description,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    location: entry.location,
    scope: entry.scope,
    rootDir: entry.rootDir,
    skillDir: entry.skillDir,
  }
}

function toSkillDirName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function assertSafeId(id: string): void {
  if (!id || UNSAFE_PATH_RE.test(id)) {
    throw new Error(`Invalid ID: ${id}`)
  }
}

export function parseAgentSkillConfig(configJson?: string | null): AgentSkillConfig {
  if (!configJson) {
    return { mode: 'inherit', selected: [] }
  }

  try {
    const parsed = JSON.parse(configJson) as { skills?: unknown }
    const rawSkills = parsed.skills
    if (!rawSkills || typeof rawSkills !== 'object') {
      return { mode: 'inherit', selected: [] }
    }

    const rawConfig = rawSkills as Record<string, unknown>
    const mode = rawConfig.mode === 'selected' ? 'selected' : 'inherit'
    const selected = Array.isArray(rawConfig.selected)
      ? rawConfig.selected.flatMap((item) => {
          if (!item || typeof item !== 'object') {
            return []
          }
        const ref = item as Record<string, unknown>
          const scope = ref.scope
          const name = ref.name
          if ((scope === 'builtin' || scope === 'global' || scope === 'workspace') && typeof name === 'string') {
            return [{ scope: scope as SkillScope, name }]
          }
          return []
        })
      : []

    return { mode, selected }
  }
  catch {
    return { mode: 'inherit', selected: [] }
  }
}

export function assertWorkspaceId(workspaceId: string): void {
  assertSafeId(workspaceId)
}
