/* Type contracts for upstream Nowledge responses used by the web panel. */

/* ─── Config / status ─────────────────────────────────────────────────── */

export interface NowledgePluginConfig {
  apiUrl: string
  mcpUrl?: string
  spaceId?: string
  enabled: boolean
  recallEnabled: false
  captureEnabled: false
  hasApiKey: boolean
}

export interface ConfigFormState {
  apiUrl: string
  mcpUrl: string
  spaceId: string
  enabled: boolean
}

export interface RouteOk<T> { ok: true, data: T }
export interface RouteErr { ok: false, code: string, message: string }
export type RouteResponse<T> = RouteOk<T> | RouteErr

/* ─── Memory ──────────────────────────────────────────────────────────── */

export interface Memory {
  id: string
  content: string
  labels?: string[]
  importance?: number
  unit_type?: string
  event_start?: string
  event_end?: string
  created_at?: string
  recorded_at?: string
  updated_at?: string
  source_thread_id?: string
  review_status?: string
  agent_id?: string
  space_id?: string
}

export interface MemorySearchResponse {
  memories?: Memory[]
  total?: number
}

/* ─── Thread ──────────────────────────────────────────────────────────── */

export interface ThreadMessage {
  role?: string
  content?: unknown
  created_at?: string
  id?: string
}

export interface ThreadSummary {
  thread_id: string
  title?: string
  source?: string
  message_count?: number
  created_at?: string
  last_message_at?: string
}

export interface ThreadSearchResponse {
  threads?: ThreadSummary[]
  total?: number
}

export interface ThreadDetail {
  thread_id: string
  title?: string
  source?: string
  messages?: ThreadMessage[]
  created_at?: string
}

/* ─── Working Memory / Context Bundle ─────────────────────────────────── */

export type WorkingMemoryEntry =
  | string
  | {
      title?: string
      content?: string
      text?: string
      summary?: string
      id?: string
      memory_id?: string
      importance?: number
      labels?: string[]
      note?: string
      body?: string
    }

export interface ReferencedMemory {
  id?: string
  memory_id?: string
  title?: string
  content?: string
}

export interface WorkingMemory {
  date?: string
  title?: string
  summary?: string
  priorities?: WorkingMemoryEntry[]
  recent_decisions?: WorkingMemoryEntry[]
  open_questions?: WorkingMemoryEntry[]
  focus_areas?: WorkingMemoryEntry[][]
  referenced_memories?: ReferencedMemory[]
  notes?: WorkingMemoryEntry[]
  active_focus?: WorkingMemoryEntry[]
  metadata?: Record<string, unknown>
}

export interface ContextBundle {
  owner?: unknown
  agent_identity?: unknown
  agent?: unknown
  space?: unknown
  rules?: unknown[]
  working_memory?: WorkingMemory
  nowledgemem_memory_refs?: Array<{ id: string, title?: string }>
  metadata?: Record<string, unknown>
}

/* ─── Status / health ─────────────────────────────────────────────────── */

export interface NowledgeHealth {
  status?: string
  ok?: boolean
  version?: string
  name?: string
  skipped?: boolean
  reason?: string
}

export interface NowledgeStatus {
  config: {
    apiUrl: string
    mcpUrl?: string
    spaceId?: string
    enabled: boolean
    recallEnabled?: false
    captureEnabled?: false
    hasApiKey: boolean
  }
  health: NowledgeHealth
}
