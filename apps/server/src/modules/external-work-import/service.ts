// Output: External AI application work import detection, mapping, and deduplication.
// Input: Server-local app data and Electron-uploaded file snapshots.
// Position: Owns Cradle import records while treating external app namespaces as read-only.

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import type { ExternalWorkImportItem } from '@cradle/db'
import {
  externalWorkImportItems,
  messages,
  sessions,
} from '@cradle/db'
import { desc, eq } from 'drizzle-orm'
import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'

import { db } from '../../infra'
import * as Preferences from '../preferences/service'
import * as Workspace from '../workspace/service'

type SourceApp = 'claude' | 'codex' | 'cursor' | 'windsurf' | 'gemini' | 'unknown'
type SourceScope = 'server' | 'electron-upload'
type SourceKind = 'settings' | 'project' | 'session' | 'instruction' | 'mcp' | 'command' | 'hook' | 'skill' | 'plugin' | 'subagent'
type ImportStatus = 'pending' | 'imported' | 'duplicate' | 'skipped' | 'error'

interface PreviewInput {
  includeHome?: boolean
  cwds?: string[]
  sourceApps?: SourceApp[]
  limitPerSource?: number
}

interface UploadPreviewInput {
  files: Array<{
    sourceApp: SourceApp
    path: string
    content: string
    workspacePath?: string | null
    modifiedAt?: number | null
  }>
}

export interface PreviewItem {
  id: string
  sourceApp: SourceApp
  sourceScope: SourceScope
  sourceKind: SourceKind
  title: string
  summary: string | null
  sourcePath: string | null
  externalId: string
  fingerprint: string
  workspacePath: string | null
  createdAt: number | null
  updatedAt: number | null
  duplicate: boolean
  duplicateImportId: string | null
  importable: boolean
  reason: string | null
  payloadJson: string
}

interface SessionMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: number | null
}

interface CandidateDraft {
  sourceApp: SourceApp
  sourceScope: SourceScope
  sourceKind: SourceKind
  title: string
  summary: string | null
  sourcePath: string | null
  externalId: string
  workspacePath: string | null
  createdAt: number | null
  updatedAt: number | null
  importable: boolean
  reason: string | null
  payload: Record<string, unknown>
}

interface ImportResultItem {
  fingerprint: string
  status: ImportStatus
  record: PublicImportRecord | null
  sessionId: string | null
  workspaceId: string | null
  reason: string | null
}

interface ImportResult {
  imported: number
  duplicates: number
  skipped: number
  errors: number
  items: ImportResultItem[]
}

type PublicImportRecord = Omit<ExternalWorkImportItem, 'payloadJson'>

const JsonLineSchema = z.record(z.string(), z.unknown())
const DEFAULT_LIMIT_PER_SOURCE = 500
const MAX_TEXT_BYTES = 8 * 1024 * 1024
const SECRET_KEY_PATTERN = /(api[_-]?key|auth|token|secret|password|credential)/i
const TEXT_FEATURE_EXTENSIONS = new Set(['.md', '.json', '.toml'])

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    )
  }
  return value
}

function unixTimeFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
  }
  return null
}

function compactText(value: string, maxLength = 180): string {
  const compacted = value.replace(/\s+/g, ' ').trim()
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 1)}...` : compacted
}

function pathParts(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean)
}

function fileExtension(path: string): string {
  const name = basename(path)
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

function recordKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return []
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry && typeof entry === 'object') {
          const name = (entry as Record<string, unknown>).name
          return typeof name === 'string' ? name : null
        }
        return null
      })
      .filter((entry): entry is string => Boolean(entry))
  }
  return Object.keys(value as Record<string, unknown>)
}

function isNonEmptyConfigValue(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  return Array.isArray(value)
    ? value.length > 0
    : Object.keys(value as Record<string, unknown>).length > 0
}

function sourceKindFromPath(path: string): SourceKind | null {
  const parts = pathParts(path).map(part => part.toLowerCase())
  if (parts.includes('commands') || parts.includes('command')) {
    return 'command'
  }
  if (parts.includes('hooks') || parts.includes('hook')) {
    return 'hook'
  }
  if (parts.includes('subagents') || parts.includes('agents')) {
    return 'subagent'
  }
  if (parts.includes('skills') || parts.includes('skill')) {
    return 'skill'
  }
  if (parts.includes('plugins') || parts.includes('plugin')) {
    return 'plugin'
  }
  return null
}

function titleFromText(value: string, fallback: string): string {
  const compacted = compactText(value, 80)
  return compacted.length > 0 ? compacted : fallback
}

function parseConfigContent(content: string, parser: 'json' | 'toml'): Record<string, unknown> | null {
  try {
    const parsed = parser === 'json' ? JSON.parse(content) : parseToml(content)
    return sanitizeSettings(parsed) as Record<string, unknown>
  }
 catch {
    return null
  }
}

function readTextFile(path: string): string | null {
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) {
      return null
    }
    return readFileSync(path, 'utf8')
  }
 catch {
    return null
  }
}

function sanitizeSettings(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeSettings)
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      continue
    }
    result[key] = sanitizeSettings(entry)
  }
  return result
}

function readJsonLines(content: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    try {
      rows.push(JsonLineSchema.parse(JSON.parse(trimmed)))
    }
 catch {
      continue
    }
  }
  return rows
}

function extractText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry
        }
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>
          return extractText(record.text ?? record.content ?? record.input_text ?? record.output_text)
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return extractText(record.text ?? record.content)
  }
  return ''
}

function createFingerprint(input: {
  sourceApp: SourceApp
  sourceKind: SourceKind
  externalId: string
  payload: Record<string, unknown>
}): string {
  return sha256(stableJson({
    sourceApp: input.sourceApp,
    sourceKind: input.sourceKind,
    externalId: input.externalId,
    payload: input.payload,
  }))
}

function candidateFromDraft(draft: CandidateDraft, duplicate: ExternalWorkImportItem | null): PreviewItem {
  const payloadJson = stableJson(draft.payload)
  const fingerprint = createFingerprint({
    sourceApp: draft.sourceApp,
    sourceKind: draft.sourceKind,
    externalId: draft.externalId,
    payload: draft.payload,
  })

  return {
    id: `${draft.sourceApp}:${draft.sourceKind}:${fingerprint.slice(0, 16)}`,
    sourceApp: draft.sourceApp,
    sourceScope: draft.sourceScope,
    sourceKind: draft.sourceKind,
    title: draft.title,
    summary: draft.summary,
    sourcePath: draft.sourcePath,
    externalId: draft.externalId,
    fingerprint,
    workspacePath: draft.workspacePath,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    duplicate: Boolean(duplicate),
    duplicateImportId: duplicate?.id ?? null,
    importable: draft.importable && !duplicate,
    reason: duplicate ? 'Already imported' : draft.reason,
    payloadJson,
  }
}

function duplicateRecord(fingerprint: string): ExternalWorkImportItem | null {
  return db()
    .select()
    .from(externalWorkImportItems)
    .where(eq(externalWorkImportItems.fingerprint, fingerprint))
    .get() ?? null
}

function applyDuplicates(drafts: CandidateDraft[]): PreviewItem[] {
  return drafts.map((draft) => {
    const fingerprint = createFingerprint({
      sourceApp: draft.sourceApp,
      sourceKind: draft.sourceKind,
      externalId: draft.externalId,
      payload: draft.payload,
    })
    return candidateFromDraft(draft, duplicateRecord(fingerprint))
  })
}

function createSettingsDraft(input: {
  sourceApp: SourceApp
  sourceScope: SourceScope
  path: string
  content: string
  parser: 'json' | 'toml'
  modifiedAt?: number | null
}): CandidateDraft | null {
  const data = parseConfigContent(input.content, input.parser)
  if (!data) {
    return null
  }
  try {
    const model = typeof data.model === 'string'
      ? data.model
      : typeof (data.env as Record<string, unknown> | undefined)?.ANTHROPIC_MODEL === 'string'
        ? String((data.env as Record<string, unknown>).ANTHROPIC_MODEL)
        : null
    return {
      sourceApp: input.sourceApp,
      sourceScope: input.sourceScope,
      sourceKind: 'settings',
      title: `${input.sourceApp} settings`,
      summary: model ? `Model: ${model}` : 'Configuration settings',
      sourcePath: input.path,
      externalId: input.path,
      workspacePath: null,
      createdAt: null,
      updatedAt: input.modifiedAt ?? null,
      importable: true,
      reason: null,
      payload: {
        kind: 'settings',
        data,
      },
    }
  }
 catch {
    return null
  }
}

function createConfigFeatureDrafts(input: {
  sourceApp: SourceApp
  sourceScope: SourceScope
  path: string
  content: string
  parser: 'json' | 'toml'
  workspacePath?: string | null
  modifiedAt?: number | null
}): CandidateDraft[] {
  const data = parseConfigContent(input.content, input.parser)
  if (!data) {
    return []
  }

  const drafts: CandidateDraft[] = []
  const mcpServers = data.mcpServers ?? data.mcp_servers
  if (isNonEmptyConfigValue(mcpServers)) {
    const names = recordKeys(mcpServers)
    drafts.push({
      sourceApp: input.sourceApp,
      sourceScope: input.sourceScope,
      sourceKind: 'mcp',
      title: `${input.sourceApp} MCP servers`,
      summary: names.length > 0 ? names.slice(0, 5).join(', ') : 'MCP server configuration',
      sourcePath: input.path,
      externalId: `${input.path}:mcp`,
      workspacePath: input.workspacePath ?? null,
      createdAt: null,
      updatedAt: input.modifiedAt ?? null,
      importable: true,
      reason: null,
      payload: {
        kind: 'mcp',
        mcpServers,
      },
    })
  }

  const hooks = data.hooks
  if (isNonEmptyConfigValue(hooks)) {
    const names = recordKeys(hooks)
    drafts.push({
      sourceApp: input.sourceApp,
      sourceScope: input.sourceScope,
      sourceKind: 'hook',
      title: `${input.sourceApp} hooks`,
      summary: names.length > 0 ? names.slice(0, 5).join(', ') : 'Hook configuration',
      sourcePath: input.path,
      externalId: `${input.path}:hooks`,
      workspacePath: input.workspacePath ?? null,
      createdAt: null,
      updatedAt: input.modifiedAt ?? null,
      importable: true,
      reason: null,
      payload: {
        kind: 'hook',
        hooks,
      },
    })
  }

  return drafts
}

function createInstructionDraft(input: {
  sourceApp: SourceApp
  sourceScope: SourceScope
  path: string
  content: string
  workspacePath: string | null
  modifiedAt?: number | null
}): CandidateDraft | null {
  return createProjectInstructionDraft({
    ...input,
    sourceKind: 'instruction',
  })
}

function createProjectDraft(input: {
  sourceApp: SourceApp
  sourceScope: SourceScope
  path: string
  content: string
  workspacePath: string | null
  modifiedAt?: number | null
}): CandidateDraft | null {
  return createProjectInstructionDraft({
    ...input,
    sourceKind: 'project',
  })
}

function createProjectInstructionDraft(input: {
  sourceApp: SourceApp
  sourceScope: SourceScope
  sourceKind: 'project' | 'instruction'
  path: string
  content: string
  workspacePath: string | null
  modifiedAt?: number | null
}): CandidateDraft | null {
  const text = compactText(input.content, 5000)
  if (!text) {
    return null
  }
  const workspaceName = input.workspacePath ? basename(input.workspacePath) : null
  return {
    sourceApp: input.sourceApp,
    sourceScope: input.sourceScope,
    sourceKind: input.sourceKind,
    title: input.sourceKind === 'project' && workspaceName
      ? `${workspaceName} project instructions`
      : basename(input.path),
    summary: compactText(text),
    sourcePath: input.path,
    externalId: input.path,
    workspacePath: input.workspacePath,
    createdAt: null,
    updatedAt: input.modifiedAt ?? null,
    importable: true,
    reason: null,
    payload: {
      kind: input.sourceKind,
      instructionFile: basename(input.path),
      text,
    },
  }
}

function createTextFeatureDraft(input: {
  sourceApp: SourceApp
  sourceScope: SourceScope
  sourceKind: SourceKind
  path: string
  content: string
  workspacePath?: string | null
  modifiedAt?: number | null
}): CandidateDraft | null {
  const text = compactText(input.content, 8000)
  if (!text) {
    return null
  }
  const title = basename(input.path).replace(/\.(md|json|toml)$/i, '')
  return {
    sourceApp: input.sourceApp,
    sourceScope: input.sourceScope,
    sourceKind: input.sourceKind,
    title: `${input.sourceApp} ${input.sourceKind}: ${title}`,
    summary: compactText(text),
    sourcePath: input.path,
    externalId: input.path,
    workspacePath: input.workspacePath ?? null,
    createdAt: null,
    updatedAt: input.modifiedAt ?? null,
    importable: true,
    reason: null,
    payload: {
      kind: input.sourceKind,
      text,
    },
  }
}

function createClaudeSessionDraft(input: {
  sourceScope: SourceScope
  path: string
  content: string
  workspacePath?: string | null
  modifiedAt?: number | null
}): CandidateDraft | null {
  const rows = readJsonLines(input.content)
  const messagesForImport: SessionMessage[] = []
  let sessionId: string | null = null
  let workspacePath: string | null = input.workspacePath ?? null
  let firstAt: number | null = null
  let lastAt: number | null = input.modifiedAt ?? null

  for (const row of rows) {
    const type = row.type
    const nested = row.message && typeof row.message === 'object'
      ? row.message as Record<string, unknown>
      : null
    const role = nested?.role === 'assistant' || nested?.role === 'user'
      ? nested.role
      : type === 'assistant' || type === 'user'
        ? type
        : null
    if (role !== 'assistant' && role !== 'user') {
      continue
    }

    const text = extractText(nested?.content ?? row.content)
    if (!text.trim()) {
      continue
    }
    const createdAt = unixTimeFromUnknown(row.timestamp)
    firstAt ??= createdAt
    lastAt = createdAt ?? lastAt
    sessionId = typeof row.sessionId === 'string' ? row.sessionId : sessionId
    workspacePath = typeof row.cwd === 'string' ? row.cwd : workspacePath
    messagesForImport.push({
      role,
      content: text,
      createdAt,
    })
  }

  if (messagesForImport.length === 0) {
    return null
  }

  const externalId = sessionId ?? basename(input.path, '.jsonl')
  const firstUserMessage = messagesForImport.find(message => message.role === 'user')?.content ?? messagesForImport[0]?.content ?? ''
  return {
    sourceApp: 'claude',
    sourceScope: input.sourceScope,
    sourceKind: 'session',
    title: titleFromText(firstUserMessage, `Claude session ${externalId}`),
    summary: `${messagesForImport.length} messages`,
    sourcePath: input.path,
    externalId,
    workspacePath,
    createdAt: firstAt,
    updatedAt: lastAt,
    importable: true,
    reason: null,
    payload: {
      kind: 'session',
      messages: messagesForImport,
    },
  }
}

function createCodexSessionDraft(input: {
  sourceScope: SourceScope
  path: string
  content: string
  workspacePath?: string | null
  modifiedAt?: number | null
}): CandidateDraft | null {
  const rows = readJsonLines(input.content)
  const messagesForImport: SessionMessage[] = []
  let sessionId: string | null = null
  let workspacePath: string | null = input.workspacePath ?? null
  let firstAt: number | null = null
  let lastAt: number | null = input.modifiedAt ?? null

  for (const row of rows) {
    if (row.type === 'session_meta' && row.payload && typeof row.payload === 'object') {
      const payload = row.payload as Record<string, unknown>
      sessionId = typeof payload.id === 'string' ? payload.id : sessionId
      workspacePath = typeof payload.cwd === 'string' ? payload.cwd : workspacePath
      continue
    }
    if (row.type !== 'response_item' || !row.payload || typeof row.payload !== 'object') {
      continue
    }

    const payload = row.payload as Record<string, unknown>
    const role = payload.role === 'assistant' || payload.role === 'user' ? payload.role : null
    if (role !== 'assistant' && role !== 'user') {
      continue
    }
    const text = extractText(payload.content)
    if (!text.trim()) {
      continue
    }
    const createdAt = unixTimeFromUnknown(row.timestamp)
    firstAt ??= createdAt
    lastAt = createdAt ?? lastAt
    messagesForImport.push({ role, content: text, createdAt })
  }

  if (messagesForImport.length === 0) {
    return null
  }

  const externalId = sessionId ?? basename(input.path, '.jsonl')
  const firstUserMessage = messagesForImport.find(message => message.role === 'user')?.content ?? messagesForImport[0]?.content ?? ''
  return {
    sourceApp: 'codex',
    sourceScope: input.sourceScope,
    sourceKind: 'session',
    title: titleFromText(firstUserMessage, `Codex session ${externalId}`),
    summary: `${messagesForImport.length} messages`,
    sourcePath: input.path,
    externalId,
    workspacePath,
    createdAt: firstAt,
    updatedAt: lastAt,
    importable: true,
    reason: null,
    payload: {
      kind: 'session',
      messages: messagesForImport,
    },
  }
}

function createCodexHistoryDraft(input: {
  sourceScope: SourceScope
  path: string
  content: string
  modifiedAt?: number | null
}): CandidateDraft[] {
  const rows = readJsonLines(input.content)
  const bySession = new Map<string, SessionMessage[]>()
  for (const row of rows) {
    if (typeof row.session_id !== 'string' || typeof row.text !== 'string') {
      continue
    }
    const createdAt = unixTimeFromUnknown(row.ts)
    const list = bySession.get(row.session_id) ?? []
    list.push({
      role: 'user',
      content: row.text,
      createdAt,
    })
    bySession.set(row.session_id, list)
  }

  return Array.from(bySession.entries()).map(([sessionId, sessionMessages]) => {
    const first = sessionMessages[0]?.content ?? ''
    const timestamps = sessionMessages.map(message => message.createdAt).filter((value): value is number => value !== null)
    return {
      sourceApp: 'codex',
      sourceScope: input.sourceScope,
      sourceKind: 'session',
      title: titleFromText(first, `Codex history ${sessionId}`),
      summary: `${sessionMessages.length} prompts`,
      sourcePath: input.path,
      externalId: `history:${sessionId}`,
      workspacePath: null,
      createdAt: timestamps.length > 0 ? Math.min(...timestamps) : null,
      updatedAt: timestamps.length > 0 ? Math.max(...timestamps) : input.modifiedAt ?? null,
      importable: true,
      reason: null,
      payload: {
        kind: 'session',
        messages: sessionMessages,
      },
    }
  })
}

function statModifiedAt(path: string): number | null {
  try {
    return Math.floor(statSync(path).mtimeMs / 1000)
  }
 catch {
    return null
  }
}

function collectFiles(root: string, extensions: string | Set<string>, limit: number): string[] {
  const allowedExtensions = typeof extensions === 'string' ? new Set([extensions]) : extensions
  const entries: Array<{ path: string, modifiedAt: number }> = []
  const visit = (dir: string, depth: number) => {
    if (depth > 4) {
      return
    }
    let children: string[]
    try {
      children = readdirSync(dir)
    }
 catch {
      return
    }
    for (const child of children) {
      const path = join(dir, child)
      try {
        const stat = statSync(path)
        if (stat.isDirectory()) {
          visit(path, depth + 1)
        }
 else if (stat.isFile() && allowedExtensions.has(fileExtension(path))) {
          entries.push({ path, modifiedAt: Math.floor(stat.mtimeMs / 1000) })
        }
      }
 catch {
        continue
      }
    }
  }
  visit(root, 0)
  return entries
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, limit)
    .map(entry => entry.path)
}

function collectTextFeatureDrafts(input: {
  sourceApp: SourceApp
  sourceScope: SourceScope
  root: string
  sourceKind: SourceKind
  limit: number
  workspacePath?: string | null
}): CandidateDraft[] {
  const drafts: CandidateDraft[] = []
  for (const path of collectFiles(input.root, TEXT_FEATURE_EXTENSIONS, input.limit)) {
    const content = readTextFile(path)
    if (!content) {
      continue
    }
    const draft = createTextFeatureDraft({
      sourceApp: input.sourceApp,
      sourceScope: input.sourceScope,
      sourceKind: input.sourceKind,
      path,
      content,
      workspacePath: input.workspacePath ?? null,
      modifiedAt: statModifiedAt(path),
    })
    if (draft) {
      drafts.push(draft)
    }
  }
  return drafts
}

function scanServerDrafts(input: PreviewInput): { drafts: CandidateDraft[], warnings: string[] } {
  const limit = input.limitPerSource ?? DEFAULT_LIMIT_PER_SOURCE
  const apps = new Set(input.sourceApps ?? ['claude', 'codex'])
  const drafts: CandidateDraft[] = []
  const warnings: string[] = []
  const home = homedir()

  if (input.includeHome !== false && apps.has('claude')) {
    const claudeDir = join(home, '.claude')
    for (const settingsPath of [join(claudeDir, 'settings.json'), join(claudeDir, 'settings.local.json'), join(claudeDir, 'config.json')]) {
      const content = readTextFile(settingsPath)
      if (content) {
        const draft = createSettingsDraft({
          sourceApp: 'claude',
          sourceScope: 'server',
          path: settingsPath,
          content,
          parser: 'json',
          modifiedAt: statModifiedAt(settingsPath),
        })
        if (draft) {
          drafts.push(draft)
        }
        drafts.push(...createConfigFeatureDrafts({
          sourceApp: 'claude',
          sourceScope: 'server',
          path: settingsPath,
          content,
          parser: 'json',
          modifiedAt: statModifiedAt(settingsPath),
        }))
      }
    }
    for (const path of collectFiles(join(claudeDir, 'projects'), '.jsonl', limit)) {
      const content = readTextFile(path)
      if (!content) {
        continue
      }
      const draft = createClaudeSessionDraft({
        sourceScope: 'server',
        path,
        content,
        modifiedAt: statModifiedAt(path),
      })
      if (draft) {
        drafts.push(draft)
      }
    }
    drafts.push(...collectTextFeatureDrafts({
      sourceApp: 'claude',
      sourceScope: 'server',
      root: join(claudeDir, 'commands'),
      sourceKind: 'command',
      limit,
    }))
    drafts.push(...collectTextFeatureDrafts({
      sourceApp: 'claude',
      sourceScope: 'server',
      root: join(claudeDir, 'hooks'),
      sourceKind: 'hook',
      limit,
    }))
    drafts.push(...collectTextFeatureDrafts({
      sourceApp: 'claude',
      sourceScope: 'server',
      root: join(claudeDir, 'agents'),
      sourceKind: 'subagent',
      limit,
    }))
    drafts.push(...collectTextFeatureDrafts({
      sourceApp: 'claude',
      sourceScope: 'server',
      root: join(claudeDir, 'skills'),
      sourceKind: 'skill',
      limit,
    }))
  }

  if (input.includeHome !== false && apps.has('codex')) {
    const codexDir = join(home, '.codex')
    const configPath = join(codexDir, 'config.toml')
    const configContent = readTextFile(configPath)
    if (configContent) {
      const draft = createSettingsDraft({
        sourceApp: 'codex',
        sourceScope: 'server',
        path: configPath,
        content: configContent,
        parser: 'toml',
        modifiedAt: statModifiedAt(configPath),
      })
      if (draft) {
        drafts.push(draft)
      }
      drafts.push(...createConfigFeatureDrafts({
        sourceApp: 'codex',
        sourceScope: 'server',
        path: configPath,
        content: configContent,
        parser: 'toml',
        modifiedAt: statModifiedAt(configPath),
      }))
    }

    const agentsPath = join(codexDir, 'AGENTS.md')
    const agentsContent = readTextFile(agentsPath)
    if (agentsContent) {
      const draft = createInstructionDraft({
        sourceApp: 'codex',
        sourceScope: 'server',
        path: agentsPath,
        content: agentsContent,
        workspacePath: null,
        modifiedAt: statModifiedAt(agentsPath),
      })
      if (draft) {
        drafts.push(draft)
      }
    }

    const historyPath = join(codexDir, 'history.jsonl')
    const historyContent = readTextFile(historyPath)
    if (historyContent) {
      drafts.push(...createCodexHistoryDraft({
        sourceScope: 'server',
        path: historyPath,
        content: historyContent,
        modifiedAt: statModifiedAt(historyPath),
      }).slice(0, limit))
    }

    for (const path of collectFiles(join(codexDir, 'archived_sessions'), '.jsonl', limit)) {
      const content = readTextFile(path)
      if (!content) {
        continue
      }
      const draft = createCodexSessionDraft({
        sourceScope: 'server',
        path,
        content,
        modifiedAt: statModifiedAt(path),
      })
      if (draft) {
        drafts.push(draft)
      }
    }

    drafts.push(...collectTextFeatureDrafts({
      sourceApp: 'codex',
      sourceScope: 'server',
      root: join(codexDir, 'commands'),
      sourceKind: 'command',
      limit,
    }))
    drafts.push(...collectTextFeatureDrafts({
      sourceApp: 'codex',
      sourceScope: 'server',
      root: join(codexDir, 'hooks'),
      sourceKind: 'hook',
      limit,
    }))
    drafts.push(...collectTextFeatureDrafts({
      sourceApp: 'codex',
      sourceScope: 'server',
      root: join(codexDir, 'subagents'),
      sourceKind: 'subagent',
      limit,
    }))
    drafts.push(...collectTextFeatureDrafts({
      sourceApp: 'codex',
      sourceScope: 'server',
      root: join(codexDir, 'skills'),
      sourceKind: 'skill',
      limit,
    }))
    drafts.push(...collectTextFeatureDrafts({
      sourceApp: 'codex',
      sourceScope: 'server',
      root: join(codexDir, 'plugins'),
      sourceKind: 'plugin',
      limit,
    }))
  }

  for (const cwd of input.cwds ?? []) {
    if (!existsSync(cwd)) {
      warnings.push(`Skipped missing workspace path: ${cwd}`)
      continue
    }
    for (const [sourceApp, fileName] of [
      ['codex', 'AGENTS.md'],
      ['claude', 'CLAUDE.md'],
    ] as const) {
      if (!apps.has(sourceApp)) {
        continue
      }
      const path = join(cwd, fileName)
      const content = readTextFile(path)
      if (!content) {
        continue
      }
      const draft = createProjectDraft({
        sourceApp,
        sourceScope: 'server',
        path,
        content,
        workspacePath: cwd,
        modifiedAt: statModifiedAt(path),
      })
      if (draft) {
        drafts.push(draft)
      }
    }
    if (apps.has('codex')) {
      drafts.push(...collectTextFeatureDrafts({
        sourceApp: 'codex',
        sourceScope: 'server',
        root: join(cwd, '.codex', 'commands'),
        sourceKind: 'command',
        limit,
        workspacePath: cwd,
      }))
      drafts.push(...collectTextFeatureDrafts({
        sourceApp: 'codex',
        sourceScope: 'server',
        root: join(cwd, '.codex', 'hooks'),
        sourceKind: 'hook',
        limit,
        workspacePath: cwd,
      }))
      drafts.push(...collectTextFeatureDrafts({
        sourceApp: 'codex',
        sourceScope: 'server',
        root: join(cwd, '.codex', 'subagents'),
        sourceKind: 'subagent',
        limit,
        workspacePath: cwd,
      }))
    }
    if (apps.has('claude')) {
      drafts.push(...collectTextFeatureDrafts({
        sourceApp: 'claude',
        sourceScope: 'server',
        root: join(cwd, '.claude', 'commands'),
        sourceKind: 'command',
        limit,
        workspacePath: cwd,
      }))
      drafts.push(...collectTextFeatureDrafts({
        sourceApp: 'claude',
        sourceScope: 'server',
        root: join(cwd, '.claude', 'hooks'),
        sourceKind: 'hook',
        limit,
        workspacePath: cwd,
      }))
      drafts.push(...collectTextFeatureDrafts({
        sourceApp: 'claude',
        sourceScope: 'server',
        root: join(cwd, '.claude', 'agents'),
        sourceKind: 'subagent',
        limit,
        workspacePath: cwd,
      }))
    }
  }

  return { drafts, warnings }
}

export function preview(input: PreviewInput = {}): { items: PreviewItem[], warnings: string[] } {
  const { drafts, warnings } = scanServerDrafts(input)
  return {
    items: applyDuplicates(drafts),
    warnings,
  }
}

export function uploadPreview(input: UploadPreviewInput): { items: PreviewItem[], warnings: string[] } {
  const drafts: CandidateDraft[] = []
  for (const file of input.files) {
    const featureKind = sourceKindFromPath(file.path)
    if (featureKind && TEXT_FEATURE_EXTENSIONS.has(fileExtension(file.path))) {
      const draft = createTextFeatureDraft({
        sourceApp: file.sourceApp,
        sourceScope: 'electron-upload',
        sourceKind: featureKind,
        path: file.path,
        content: file.content,
        workspacePath: file.workspacePath ?? null,
        modifiedAt: file.modifiedAt ?? null,
      })
      if (draft) {
        drafts.push(draft)
      }
      continue
    }

    if (file.path.endsWith('.jsonl')) {
      if (file.sourceApp === 'claude') {
        const draft = createClaudeSessionDraft({
          sourceScope: 'electron-upload',
          path: file.path,
          content: file.content,
          workspacePath: file.workspacePath ?? null,
          modifiedAt: file.modifiedAt ?? null,
        })
        if (draft) {
          drafts.push(draft)
        }
      }
 else if (file.sourceApp === 'codex') {
        if (basename(file.path) === 'history.jsonl') {
          drafts.push(...createCodexHistoryDraft({
            sourceScope: 'electron-upload',
            path: file.path,
            content: file.content,
            modifiedAt: file.modifiedAt ?? null,
          }))
        }
 else {
          const draft = createCodexSessionDraft({
            sourceScope: 'electron-upload',
            path: file.path,
            content: file.content,
            workspacePath: file.workspacePath ?? null,
            modifiedAt: file.modifiedAt ?? null,
          })
          if (draft) {
            drafts.push(draft)
          }
        }
      }
      continue
    }

    if (file.path.endsWith('.toml')) {
      const draft = createSettingsDraft({
        sourceApp: file.sourceApp,
        sourceScope: 'electron-upload',
        path: file.path,
        content: file.content,
        parser: 'toml',
        modifiedAt: file.modifiedAt ?? null,
      })
      if (draft) {
        drafts.push(draft)
      }
      drafts.push(...createConfigFeatureDrafts({
        sourceApp: file.sourceApp,
        sourceScope: 'electron-upload',
        path: file.path,
        content: file.content,
        parser: 'toml',
        modifiedAt: file.modifiedAt ?? null,
      }))
      continue
    }

    if (file.path.endsWith('.json')) {
      const draft = createSettingsDraft({
        sourceApp: file.sourceApp,
        sourceScope: 'electron-upload',
        path: file.path,
        content: file.content,
        parser: 'json',
        modifiedAt: file.modifiedAt ?? null,
      })
      if (draft) {
        drafts.push(draft)
      }
      drafts.push(...createConfigFeatureDrafts({
        sourceApp: file.sourceApp,
        sourceScope: 'electron-upload',
        path: file.path,
        content: file.content,
        parser: 'json',
        modifiedAt: file.modifiedAt ?? null,
      }))
      continue
    }

    if (basename(file.path) === 'AGENTS.md' || basename(file.path) === 'CLAUDE.md') {
      const draft = file.workspacePath
        ? createProjectDraft({
            sourceApp: file.sourceApp,
            sourceScope: 'electron-upload',
            path: file.path,
            content: file.content,
            workspacePath: file.workspacePath,
            modifiedAt: file.modifiedAt ?? null,
          })
        : createInstructionDraft({
            sourceApp: file.sourceApp,
            sourceScope: 'electron-upload',
            path: file.path,
            content: file.content,
            workspacePath: null,
            modifiedAt: file.modifiedAt ?? null,
          })
      if (draft) {
        drafts.push(draft)
      }
    }
  }

  return {
    items: applyDuplicates(drafts),
    warnings: [],
  }
}

function resolveWorkspaceId(workspacePath: string | null): string | null {
  if (!workspacePath || !existsSync(workspacePath)) {
    return null
  }
  const existing = Workspace.resolveByPath(workspacePath)
  if (existing) {
    return existing.id
  }
  try {
    return Workspace.create({ name: basename(workspacePath), path: workspacePath }).id
  }
 catch {
    return Workspace.resolveByPath(workspacePath)?.id ?? null
  }
}

async function importSettings(item: PreviewItem): Promise<void> {
  const payload = z.object({
    data: z.record(z.string(), z.unknown()),
  }).passthrough().parse(JSON.parse(item.payloadJson))
  const data = payload.data
  const current = Preferences.getChatPreferencesSync()
  const configSelections = { ...current.configSelections }
  const modelId = typeof data.model === 'string'
    ? data.model
    : typeof (data.env as Record<string, unknown> | undefined)?.ANTHROPIC_MODEL === 'string'
      ? String((data.env as Record<string, unknown>).ANTHROPIC_MODEL)
      : current.modelId

  if (typeof data.model_reasoning_effort === 'string') {
    configSelections.reasoningEffort = data.model_reasoning_effort
  }

  await Preferences.setChatPreferences({
    ...current,
    modelId,
    configSelections,
  })
}

function insertImportedSession(item: PreviewItem, workspaceId: string | null): string | null {
  const payload = z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      createdAt: z.number().nullable(),
    })),
  }).passthrough().parse(JSON.parse(item.payloadJson))

  if (payload.messages.length === 0) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const createdAt = item.createdAt ?? payload.messages[0]?.createdAt ?? now
  const updatedAt = item.updatedAt ?? payload.messages.at(-1)?.createdAt ?? createdAt
  const sessionId = randomUUID()

  db().insert(sessions).values({
    id: sessionId,
    workspaceId,
    title: item.title,
    providerTargetId: null,
    runtimeKind: item.sourceApp === 'codex' ? 'codex' : item.sourceApp === 'claude' ? 'claude-agent' : 'standard',
    agentId: null,
    configJson: stableJson({
      importedFrom: {
        sourceApp: item.sourceApp,
        sourceScope: item.sourceScope,
        sourcePath: item.sourcePath,
        externalId: item.externalId,
        fingerprint: item.fingerprint,
      },
    }),
    createdAt,
    updatedAt,
  }).run()

  for (const [index, message] of payload.messages.entries()) {
    const messageId = randomUUID()
    const messageCreatedAt = message.createdAt ?? createdAt + index
    const snapshot = {
      id: messageId,
      role: message.role,
      parts: [
        { type: 'text', text: message.content },
      ],
    }
    db().insert(messages).values({
      id: messageId,
      sessionId,
      role: message.role,
      status: 'complete',
      content: message.content,
      messageJson: stableJson(snapshot),
      createdAt: messageCreatedAt,
      updatedAt: messageCreatedAt,
    }).run()
  }

  return sessionId
}

function insertRecord(input: {
  item: PreviewItem
  workspaceId: string | null
  sessionId: string | null
  messageId: string | null
  status: 'imported' | 'skipped' | 'error'
  statusReason: string | null
}): ExternalWorkImportItem {
  const now = Math.floor(Date.now() / 1000)
  return db().insert(externalWorkImportItems).values({
    id: randomUUID(),
    sourceApp: input.item.sourceApp,
    sourceScope: input.item.sourceScope,
    sourceKind: input.item.sourceKind,
    sourcePath: input.item.sourcePath,
    externalId: input.item.externalId,
    fingerprint: input.item.fingerprint,
    title: input.item.title,
    summary: input.item.summary,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    payloadJson: input.item.payloadJson,
    status: input.status,
    statusReason: input.statusReason,
    importedAt: now,
    createdAt: now,
    updatedAt: now,
  }).returning().get()
}

function publicRecord(record: ExternalWorkImportItem): PublicImportRecord {
  const { payloadJson: _payloadJson, ...publicFields } = record
  return publicFields
}

export async function importItems(items: PreviewItem[]): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    duplicates: 0,
    skipped: 0,
    errors: 0,
    items: [],
  }

  for (const item of items) {
    const duplicate = duplicateRecord(item.fingerprint)
    if (duplicate) {
      result.duplicates += 1
      result.items.push({
        fingerprint: item.fingerprint,
        status: 'duplicate',
        record: publicRecord(duplicate),
        sessionId: duplicate.sessionId,
        workspaceId: duplicate.workspaceId,
        reason: 'Already imported',
      })
      continue
    }

    if (!item.importable) {
      const record = insertRecord({
        item,
        workspaceId: null,
        sessionId: null,
        messageId: null,
        status: 'skipped',
        statusReason: item.reason ?? 'Item is not importable',
      })
      result.skipped += 1
      result.items.push({
        fingerprint: item.fingerprint,
        status: 'skipped',
        record: publicRecord(record),
        sessionId: null,
        workspaceId: null,
        reason: record.statusReason,
      })
      continue
    }

    try {
      const workspaceId = resolveWorkspaceId(item.workspacePath)
      if (item.sourceKind === 'settings') {
        await importSettings(item)
      }
      const sessionId = item.sourceKind === 'session' ? insertImportedSession(item, workspaceId) : null
      const record = insertRecord({
        item,
        workspaceId,
        sessionId,
        messageId: null,
        status: 'imported',
        statusReason: null,
      })
      result.imported += 1
      result.items.push({
        fingerprint: item.fingerprint,
        status: 'imported',
        record: publicRecord(record),
        sessionId,
        workspaceId,
        reason: null,
      })
    }
 catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const record = insertRecord({
        item,
        workspaceId: null,
        sessionId: null,
        messageId: null,
        status: 'error',
        statusReason: message,
      })
      result.errors += 1
      result.items.push({
        fingerprint: item.fingerprint,
        status: 'error',
        record: publicRecord(record),
        sessionId: null,
        workspaceId: null,
        reason: message,
      })
    }
  }

  return result
}

export function listRecords(): PublicImportRecord[] {
  return db()
    .select()
    .from(externalWorkImportItems)
    .orderBy(desc(externalWorkImportItems.importedAt))
    .limit(100)
    .all()
    .map(publicRecord)
}
