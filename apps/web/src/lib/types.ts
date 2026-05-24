import type { Issue as DbIssue, KanbanIssueComment as DbKanbanIssueComment } from '@cradle/db'

// ── DB entity types (from @cradle/db — import type only, erased by bundler) ──

export type {
  Agent,
  AgentActivity,
  AgentProfile,
  AgentSession,
  Issue,
  IssueComment,
  IssueMilestone,
  IssueRelation,
  IssueStatus,
  KanbanBoard,
  KanbanIssueComment,
  KanbanIssueRelation,
  KanbanMilestone,
  KanbanStatus,
  Session,
  Workspace,
} from '@cradle/db'

export type KanbanIssue = Omit<DbIssue, 'labels'> & { labels: string[] }

export interface IssueCommentAuthor {
  kind: 'user' | 'agent' | 'system'
  id: string | null
  displayName: string
  avatarUrl: string | null
  label: string | null
}

export type KanbanIssueCommentView = DbKanbanIssueComment & {
  author: IssueCommentAuthor
}

// ── Provider / Runtime types ───────────────────────────────────────────────

export type ProviderKind = 'openai-compatible' | 'anthropic'

export type RuntimeKind = 'standard' | 'claude-agent' | 'codex' | 'jar-core' | 'acp-chat' | 'cli-tui'

export type ProviderTargetKind = 'manual' | 'external'

export interface ProviderTarget {
  kind?: ProviderTargetKind
  id: string
}

export interface CliTuiLaunchConfig {
  preset?: string
  executable: string
  args?: string[]
  env?: Record<string, string>
}

export interface AgentRuntimeConfig {
  systemPrompt?: string
  cliTui?: CliTuiLaunchConfig
  [key: string]: unknown
}

export interface ModelCapabilities {
  contextWindow?: number
  maxOutput?: number
  inputModalities?: string[]
  outputModalities?: string[]
  reasoning?: boolean
  toolCall?: boolean
  temperature?: boolean
  structuredOutput?: boolean
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
  }
  family?: string
  knowledgeCutoff?: string
  releaseDate?: string
  registryMatch?: 'exact' | 'fuzzy' | 'manual' | 'unmatched'
  registryModelId?: string
  registryModelLabel?: string
}

export interface ModelDescriptor {
  id: string
  label: string
  providerKind: ProviderKind
  capabilities: ModelCapabilities
}

interface _ProviderHealthCheckResult {
  ok: boolean
  latencyMs: number
  error?: string
}

interface _CredentialMetadata {
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
  providerTargetId?: string | null
  modelId?: string | null
  thinkingEffort?: 'low' | 'medium' | 'high' | 'auto'
  runtimeKind?: RuntimeKind
  configJson?: string
}

export interface UpdateAgentInput {
  name?: string
  description?: string | null
  avatarStyle?: string
  avatarSeed?: string
  avatarUrl?: string | null
  providerTargetId?: string | null
  modelId?: string | null
  thinkingEffort?: 'low' | 'medium' | 'high' | 'auto'
  runtimeKind?: RuntimeKind
  configJson?: string
  enabled?: boolean
}

// ── Git types ───────────────────────────────────────────────────────────────

type GitFileStatusKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export interface GitFileStatus {
  path: string
  status: GitFileStatusKind
}

export interface GitStatus {
  branch: string
  tracking: string | null
  ahead: number
  behind: number
  isDetached: boolean
  files: GitFileStatus[]
}

interface GitLocalBranch {
  name: string
  isCurrent: boolean
  tracking?: string
}

interface GitRemoteBranch {
  name: string
}

export interface GitBranches {
  local: GitLocalBranch[]
  remote: GitRemoteBranch[]
}

export interface GitRemote {
  name: string
  fetchUrl: string | null
  pushUrl: string | null
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

interface _ThreadSearchParams {
  query: string
  workspaceId?: string
  limit?: number
  snippetsPerHit?: number
}

export interface ChronicleSearchSnippet {
  text: string
  ranges: MatchRange[]
}

export interface ChronicleSearchHit {
  type: 'memory' | 'knowledge'
  id: string
  workspaceId: string | null
  workspaceName: string | null
  title: string
  titleRanges: MatchRange[]
  snippet: ChronicleSearchSnippet
  matchCount: number
  score: number
  updatedAt: number
  memoryType?: '10min' | '6h'
  memorySource?: 'llm' | 'local' | 'imported'
  cardType?: 'fact' | 'insight' | 'decision' | 'task' | 'pattern'
  dimension?: 'technical' | 'business' | 'personal' | 'project' | 'general'
  status?: 'active' | 'merged' | 'archived' | 'deleted'
}

// ── Skills types ────────────────────────────────────────────────────────────

export type SkillScope = 'builtin' | 'legacy' | 'global' | 'workspace' | 'agent'

interface SkillContext {
  workspacePath?: string
  agentId?: string
}

interface SkillCatalogEntry {
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

interface _CreateSkillInput {
  name: string
  description: string
  content: string
  location?: string
  context?: SkillContext
}

interface _UpdateSkillInput {
  name?: string
  description?: string
  content?: string
  location?: string
  context?: SkillContext
}

// ── ACP / registry types ────────────────────────────────────────────────────

interface _RegistryAgent {
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

type SkillSourceType = 'github' | 'gitlab' | 'git' | 'local'

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

interface _AcpSessionState {
  agentId: string
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
}

// ── Pack codebase types ─────────────────────────────────────────────────────

type PackStyle = 'xml' | 'markdown' | 'plain'

interface _PackCodebaseOptions {
  style: PackStyle
  compress: boolean
  include?: string
  ignore?: string
  removeComments?: boolean
  removeEmptyLines?: boolean
}

interface _PackCodebaseResult {
  content: string
  totalFiles: number
  totalTokens: number
}

// ── Usage types ─────────────────────────────────────────────────────────────

interface _DailyUsage {
  date: string
  inputTokens: number
  outputTokens: number
  cost: number
}

interface _UsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
  sessionCount: number
}
