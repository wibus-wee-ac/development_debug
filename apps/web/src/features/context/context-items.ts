// Output: Typed semantic context item contracts for Jarvis prompt assembly.
// Input: Feature-owned context providers and legacy SystemAgentContext projections.
// Position: Shared cross-cutting module — consumed by system-agent, chat, kanban, and other features.

export type ContextItemKind
  = | 'attention'
    | 'selection'
    | 'entity'
    | 'view'
    | 'layout'
    | 'history'
    | 'retrieval'
    | 'tool-output'
    | 'memory'

export type ContextReferenceKind
  = | 'text-selection'
    | 'chat-message'
    | 'chat-session'
    | 'workspace-file'
    | 'issue'
    | 'terminal-buffer'
    | 'browser-page'
    | 'chronicle-memory'

export type ContextFreshness = 'live' | 'recent' | 'stale'
export type ContextSensitivity = 'public' | 'workspace' | 'private' | 'secret'

export interface ContextRange {
  startLine?: number
  endLine?: number
  startOffset?: number
  endOffset?: number
}

export interface ContextReference {
  kind: ContextReferenceKind
  id: string
  label: string
  uri?: string
  range?: ContextRange
}

export interface ContextItem {
  id: string
  kind: ContextItemKind
  owner: string
  title: string
  summary: string
  content?: string
  references?: ContextReference[]
  priority: number
  freshness: ContextFreshness
  sensitivity: ContextSensitivity
  tokenEstimate: number
  createdAt: number
}

export interface ContextEnvelope {
  id: string
  capturedAt: number
  activeTabId: string | null
  activeTabType: string | null
  activeTabParams: Record<string, string | undefined>
  items: ContextItem[]
}

export function estimateContextTokens(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) {
    return 0
  }

  return Math.max(1, Math.ceil(trimmed.length / 4))
}
