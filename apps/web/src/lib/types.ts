// Input: @cradle/db schema types and manual type definitions
// Output: Consolidated frontend type surface for apps/web
// Position: apps/web/src/lib/types.ts — shared type definitions for the web app

// ── DB entity types (from @cradle/db — import type only, erased by bundler) ──

export type {
  AcpAgent,
  AcpAuditEntry,
  Agent,
  AgentActivity,
  AgentCredential,
  AgentProfile,
  AgentSession,
  KanbanBoard,
  KanbanIssue,
  KanbanIssueComment,
  KanbanIssueRelation,
  KanbanMilestone,
  KanbanStatus,
  Message,
  RuntimeAuditEntry,
  Session,
  Workspace,
} from '@cradle/db'

// ── Shared event types ──────────────────────────────────────────────────────

export type { ChatTimelineEventPayload } from '@shared/chat-events'

// ── Provider / agent-runtime types ─────────────────────────────────────────

export type ProviderKind = 'acp-chat' | 'cli-tui' | 'openai-compatible' | 'codex' | 'claude-agent'

export interface ModelDescriptor {
  id: string
  label: string
  providerKind: ProviderKind
  contextWindow: number | null
}

export interface ProviderHealthCheckResult {
  ok: boolean
  latencyMs: number
  error?: string
}

export interface CredentialMetadata {
  id: string
  providerKind: ProviderKind
  label: string
  maskedSecret: string
  createdAt: number
  updatedAt: number
}

// ── Agent CRUD input types ──────────────────────────────────────────────────

export interface CreateAgentInput {
  name: string
  description?: string | null
  avatarStyle: string
  avatarSeed: string
  agentProfileId: string
  modelId?: string | null
  thinkingEffort?: 'low' | 'medium' | 'high' | 'auto'
  configJson?: string
}

export interface UpdateAgentInput {
  name?: string
  description?: string | null
  avatarStyle?: string
  avatarSeed?: string
  avatarUrl?: string | null
  agentProfileId?: string
  modelId?: string | null
  thinkingEffort?: 'low' | 'medium' | 'high' | 'auto'
  configJson?: string
  enabled?: boolean
}

// ── Git types ───────────────────────────────────────────────────────────────

export interface GitStatus {
  branch: string
  tracking: string | null
  ahead: number
  behind: number
  isDetached: boolean
}

export interface GitLocalBranch {
  name: string
  isCurrent: boolean
  tracking?: string
}

export interface GitRemoteBranch {
  name: string
}

export interface GitBranches {
  local: GitLocalBranch[]
  remote: GitRemoteBranch[]
}

export interface GitGraphCommit {
  sha: string
  shortSha: string
  parents: string[]
  refs: string[]
  subject: string
  authorName: string
  authorEmail: string
  gravatarHash: string
  date: string
  timestamp: number
}

export type GitFileStatusKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export interface GitFileStatus {
  path: string
  status: GitFileStatusKind
}

// ── Thread search types ─────────────────────────────────────────────────────

export interface MatchRange {
  start: number
  end: number
}

export interface ThreadSearchSnippet {
  text: string
  ranges: MatchRange[]
  messageRole: 'user' | 'assistant'
  messageId: string
  createdAt: number
}

export interface ThreadSearchHit {
  sessionId: string
  workspaceId: string
  workspaceName: string | null
  sessionTitle: string
  titleRanges: MatchRange[]
  snippets: ThreadSearchSnippet[]
  matchCount: number
  score: number
  updatedAt: number
}

export interface ThreadSearchParams {
  query: string
  workspaceId?: string
  limit?: number
  snippetsPerHit?: number
}

// ── Skills types ────────────────────────────────────────────────────────────

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
  content: string
  location?: string
  context?: SkillContext
}

export interface UpdateSkillInput {
  name?: string
  description?: string
  content?: string
  location?: string
  context?: SkillContext
}

// ── ACP / registry types ────────────────────────────────────────────────────

export interface RegistryAgent {
  id: string
  name: string
  version: string
  description: string
  repository?: string
  website?: string
  authors?: string[]
  license?: string
  icon?: string
  distribution: {
    binary?: Record<string, { archive: string, cmd: string, args?: string[], env?: Record<string, string> }>
    npx?: { package: string }
    uvx?: { package: string }
  }
}

export type SkillSourceType = 'github' | 'gitlab' | 'git' | 'local'

export interface ParsedSkillSource {
  type: SkillSourceType
  url: string
  ref?: string
  subpath?: string
  label: string
}

export interface DiscoveredSkill {
  name: string
  description: string
  skillDir: string
  relativePath: string
}

// ── ACP session / process types ─────────────────────────────────────────────

export interface AcpSessionState {
  agentId: string
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
}

// ── Pack codebase types ─────────────────────────────────────────────────────

export type PackStyle = 'xml' | 'markdown' | 'plain'

export interface PackCodebaseOptions {
  style: PackStyle
  compress: boolean
  include?: string
  ignore?: string
  removeComments?: boolean
  removeEmptyLines?: boolean
}

export interface PackCodebaseResult {
  content: string
  totalFiles: number
  totalTokens: number
}

// ── Usage types ─────────────────────────────────────────────────────────────

export interface DailyUsage {
  date: string
  inputTokens: number
  outputTokens: number
  cost: number
}

export interface UsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
  sessionCount: number
}
