// Input: node:fs, node:fs/promises, node:path, node:os, js-yaml, bundled resources
// Output: Filesystem-backed skills catalog scanning, CRUD, and import/export across built-in, legacy, shared, workspace, and agent roots
// Position: Skills capability library for package discovery and management across filesystem-backed tiers

import fs from 'node:fs'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import yaml from 'js-yaml'

import { getBundledResourcePath } from '../resources/bundled-resources'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const UNSAFE_PATH_RE = /[/\\]|\.\./
const LEADING_NEWLINE_RE = /^\r?\n/
const NON_SLUG_CHAR_RE = /[^a-z0-9._-]+/g
const TRIM_DASH_RE = /^-+|-+$/g
const CRADLE_DIR_PARTS = ['.cradle'] as const

const SCOPE_PRIORITY: Record<SkillScope, number> = {
  builtin: 0,
  legacy: 1,
  global: 2,
  workspace: 3,
  agent: 4,
}

export type SkillScope = 'builtin' | 'legacy' | 'global' | 'workspace' | 'agent'

export interface SkillContext {
  workspacePath?: string
  agentId?: string
}

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

export interface CreateSkillInput {
  name: string
  description: string
  body: string
  workspacePath?: string
  agentId?: string
  frontmatter?: Record<string, unknown>
}

export interface UpdateSkillInput {
  scope: SkillScope
  name: string
  workspacePath?: string
  agentId?: string
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
  agentId?: string
}

export interface ImportSkillInput {
  sourceDir: string
  workspacePath?: string
  agentId?: string
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

interface DirectoryScanCacheEntry {
  signature: string
  entries: SkillCatalogEntry[]
}

const directoryScanCache = new Map<string, DirectoryScanCacheEntry>()

/**
 * Scan skills directories for SKILL.md files.
 * Priority (lowest to highest): built-in → legacy → shared → workspace → agent.
 * Same-named skills are overwritten by higher-priority sources.
 */
export function scanSkills(context: SkillContext = {}): SkillCatalogEntry[] {
  const inventory = listSkillInventory(context)
  return inventory.filter(entry => entry.active)
}

export function listSkillInventory(context: SkillContext = {}): SkillInventoryEntry[] {
  const scopedEntries = scanAllScopes(context)
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
  const rootDir = resolveScopeRoot(scope, input)
  const skillDir = path.join(rootDir, toSkillDirName(input.name))

  if (fs.existsSync(skillDir)) {
    throw new Error(`Skill "${input.name}" already exists`)
  }

  await mkdir(skillDir, { recursive: true })
  const frontmatter = {
    ...(input.frontmatter ?? {}),
    name: input.name,
    description: input.description,
  }
  const skillPath = path.join(skillDir, 'SKILL.md')
  await writeFile(skillPath, serializeSkillDocument(frontmatter, input.body), 'utf8')
  invalidateScopeCache(scope, input)

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
    agentId: input.agentId,
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
    throw new Error(`Skill "${input.name}" already exists at target location`)
  }

  if (targetSkillDir !== existing.skillDir) {
    await rename(existing.skillDir, targetSkillDir)
  }

  const targetLocation = path.join(targetSkillDir, 'SKILL.md')
  await writeFile(targetLocation, serializeSkillDocument(nextFrontmatter, input.document.body), 'utf8')
  invalidateScopeCache(input.scope, input)

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
  invalidateScopeCache(input.scope, input)
}

export async function importSkillPackage(scope: SkillScope, input: ImportSkillInput): Promise<SkillDocument> {
  assertWritableScope(scope)
  const sourceSkillPath = path.join(input.sourceDir, 'SKILL.md')
  const content = await readFile(sourceSkillPath, 'utf8')
  const parsed = parseSkillDocument(content)
  assertSkillName(parsed.name)

  const rootDir = resolveScopeRoot(scope, input)
  const targetDir = path.join(rootDir, toSkillDirName(parsed.name))

  if (fs.existsSync(targetDir)) {
    if (!input.overwrite) {
      throw new Error(`Skill already exists: ${parsed.name}`)
    }
    await rm(targetDir, { recursive: true, force: true })
  }

  await mkdir(rootDir, { recursive: true })
  await cp(input.sourceDir, targetDir, { recursive: true })
  invalidateScopeCache(scope, input)

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

export interface ImportMultipleInput {
  /** Source directories to import (each directory must contain a SKILL.md) */
  sourceDirs: string[]
  workspacePath?: string
  agentId?: string
  overwrite?: boolean
}

/**
 * Import multiple skill packages from an array of source directories.
 * Errors are collected per-skill and returned — a failure on one skill does not abort others.
 */
export async function importMultipleSkillPackages(
  scope: SkillScope,
  input: ImportMultipleInput,
): Promise<{ imported: SkillDocument[], errors: Array<{ dir: string, error: string }> }> {
  const imported: SkillDocument[] = []
  const errors: Array<{ dir: string, error: string }> = []

  for (const sourceDir of input.sourceDirs) {
    try {
      const doc = await importSkillPackage(scope, {
        sourceDir,
        overwrite: input.overwrite,
        workspacePath: input.workspacePath,
        agentId: input.agentId,
      })
      imported.push(doc)
    }
    catch (err) {
      errors.push({ dir: sourceDir, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { imported, errors }
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

function scanAllScopes(context: SkillContext): ScopeScanResult[] {
  const results: ScopeScanResult[] = []
  const builtinRoot = resolveScopeRoot('builtin', context)
  results.push({
    scope: 'builtin',
    entries: scanDirectory(builtinRoot, 'builtin'),
  })

  const legacyRoot = resolveScopeRoot('legacy', context)
  results.push({
    scope: 'legacy',
    entries: scanDirectory(legacyRoot, 'legacy'),
  })

  const globalRoot = resolveScopeRoot('global', context)
  results.push({
    scope: 'global',
    entries: scanDirectory(globalRoot, 'global'),
  })

  if (context.workspacePath) {
    const workspaceRoot = resolveScopeRoot('workspace', context)
    results.push({
      scope: 'workspace',
      entries: scanDirectory(workspaceRoot, 'workspace'),
    })
  }

  if (context.agentId) {
    const agentRoot = resolveScopeRoot('agent', context)
    results.push({
      scope: 'agent',
      entries: scanDirectory(agentRoot, 'agent'),
    })
  }

  return results
}

function scanDirectory(rootDir: string, scope: SkillScope): SkillCatalogEntry[] {
  if (!fs.existsSync(rootDir)) {
    directoryScanCache.delete(getDirectoryScanCacheKey(scope, rootDir))
    return []
  }

  let dirEntries: fs.Dirent[]
  try {
    dirEntries = fs.readdirSync(rootDir, { withFileTypes: true })
  }
  catch {
    directoryScanCache.delete(getDirectoryScanCacheKey(scope, rootDir))
    return []
  }

  const candidates: Array<{ skillDir: string, skillPath: string }> = []
  const signatureParts: string[] = []
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
      const stat = fs.statSync(skillPath)
      signatureParts.push(`${dirEntry.name}:${stat.size}:${stat.mtimeMs}`)
      candidates.push({ skillDir, skillPath })
    }
    catch {
      // Ignore transient files or stat failures.
    }
  }

  const cacheKey = getDirectoryScanCacheKey(scope, rootDir)
  const signature = signatureParts.join('|')
  const cached = directoryScanCache.get(cacheKey)
  if (cached && cached.signature === signature) {
    return cloneCatalogEntries(cached.entries)
  }

  const result: SkillCatalogEntry[] = []
  for (const { skillDir, skillPath } of candidates) {
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

  directoryScanCache.set(cacheKey, {
    signature,
    entries: cloneCatalogEntries(result),
  })

  return result
}

function resolveInventoryEntry(input: SkillLookup): SkillCatalogEntry {
  const entries = listSkillInventory({
    workspacePath: input.workspacePath,
    agentId: input.agentId,
  })
  const match = entries.find(entry => entry.scope === input.scope && entry.name === input.name)
  if (!match) {
    throw new Error(`Skill not found: ${input.scope}:${input.name}`)
  }
  return match
}

function resolveScopeRoot(scope: SkillScope, context: SkillContext): string {
  switch (scope) {
    case 'builtin':
      return getBundledResourcePath('skills')
    case 'legacy':
      return path.join(os.homedir(), '.agents', 'skills')
    case 'global':
      return path.join(os.homedir(), ...CRADLE_DIR_PARTS, 'skills')
    case 'workspace':
      if (!context.workspacePath) {
        throw new Error('workspacePath is required for workspace skills')
      }
      return path.join(context.workspacePath, '.agents', 'skills')
    case 'agent':
      if (!context.agentId) {
        throw new Error('agentId is required for agent skills')
      }
      assertAgentId(context.agentId)
      return path.join(os.homedir(), ...CRADLE_DIR_PARTS, 'agents', context.agentId, 'skills')
  }
}

function assertWritableScope(scope: SkillScope): void {
  if (scope === 'builtin' || scope === 'legacy') {
    throw new Error(`${scope} skills are read-only`)
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
    body: content.slice(match[0].length).replace(LEADING_NEWLINE_RE, ''),
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
    .replace(NON_SLUG_CHAR_RE, '-')
    .replace(TRIM_DASH_RE, '')
}

function assertSafeId(id: string): void {
  if (!id || UNSAFE_PATH_RE.test(id)) {
    throw new Error(`Invalid ID: ${id}`)
  }
}

export function assertWorkspaceId(workspaceId: string): void {
  assertSafeId(workspaceId)
}

export function assertAgentId(agentId: string): void {
  assertSafeId(agentId)
}

function cloneCatalogEntries(entries: SkillCatalogEntry[]): SkillCatalogEntry[] {
  return entries.map(entry => ({ ...entry }))
}

function getDirectoryScanCacheKey(scope: SkillScope, rootDir: string): string {
  return `${scope}:${rootDir}`
}

function invalidateScopeCache(scope: SkillScope, context: SkillContext): void {
  try {
    directoryScanCache.delete(getDirectoryScanCacheKey(scope, resolveScopeRoot(scope, context)))
  }
  catch {
    // Ignore invalidation failures for partial contexts.
  }
}
