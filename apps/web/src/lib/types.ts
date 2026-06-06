import type {
  GetAgentsResponse,
  GetChatRuntimesResponse,
  GetProfilesResponse,
  GetProviderTargetsResponse,
  GetProvidersTargetsByProviderTargetIdModelsCacheResponse,
  GetSearchChronicleResponse,
  GetSearchThreadsResponse,
  GetSkillsResponse,
  GetWorkspacesByIdGitBranchesResponse,
  GetWorkspacesByIdGitGraphResponse,
  GetWorkspacesByIdGitRemotesResponse,
  GetWorkspacesByIdGitStatusResponse,
  GetWorkspacesResponse,
} from '~/api-gen/types.gen'

// ── Server API entity types ─────────────────────────────────────────────────

export type Workspace = GetWorkspacesResponse[number]
export type Agent = GetAgentsResponse[number]
export type AgentProfile = GetProfilesResponse[number]
export type ProviderTargetRecord = GetProviderTargetsResponse[number]
export type ChatRuntimeCatalogItem = GetChatRuntimesResponse['items'][number]

// ── Provider / Runtime types ───────────────────────────────────────────────

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'universal' | 'cli-tool'
export type ApiProviderKind = Exclude<ProviderKind, 'cli-tool'>

export type BuiltinRuntimeKind = 'standard' | 'claude-agent' | 'codex' | 'jar-core' | 'acp-chat' | 'cli-tui'
export type RuntimeKind = string

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
  reasoningEfforts?: Array<'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>
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
  registryMatch?: 'exact' | 'fuzzy' | 'manual' | 'alias' | 'unmatched'
  registryModelId?: string
  registryModelLabel?: string
}

export interface ModelDescriptor {
  id: string
  label: string
  providerKind: ProviderKind
  capabilities: ModelCapabilities
}

interface _CredentialMetadata {
  id: string
  providerKind: ProviderKind
  label: string
  maskedSecret: string
  createdAt: number
  updatedAt: number
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

export type SkillScope = 'builtin' | 'legacy' | 'global' | 'repository' | 'workspace' | 'agent'

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
