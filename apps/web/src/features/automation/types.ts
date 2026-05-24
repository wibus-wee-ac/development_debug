export type AutomationRunStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled' | 'skipped'

export interface AutomationTrigger {
  type: 'rrule'
  rrule: string
  timezone: string
  misfirePolicy?: 'skip' | 'run_latest'
}

export interface AutomationInput {
  type: 'file_ref' | 'inline_file' | 'text' | 'url'
  name?: string
  path?: string
  content?: string
  url?: string
}

export interface AutomationArtifactRequest {
  name: string
  kind?: string
  description?: string
}

export interface AutomationRecipe {
  kind: 'agent_task'
  prompt: string
  inputs?: AutomationInput[]
  artifactRequests?: AutomationArtifactRequest[]
  agentId?: string | null
  providerTargetId?: string | null
  runtimeKind?: 'standard' | 'claude-agent' | 'codex' | 'jar-core' | 'acp-chat' | null
  modelId?: string | null
  thinkingEffort?: 'low' | 'medium' | 'high' | null
}

export interface AutomationDefinition {
  id: string
  title: string
  description?: string | null
  enabled?: boolean
  trigger?: AutomationTrigger | null
  triggerJson?: AutomationTrigger | null
  recipe?: AutomationRecipe | null
  recipeJson?: AutomationRecipe | null
  createdBy?: string | null
  createdAt?: number | string | null
  updatedAt?: number | string | null
  nextRunAt?: number | string | null
  latestRun?: AutomationRun | null
}

export interface AutomationRun {
  id: string
  automationId?: string
  definitionId?: string
  status: AutomationRunStatus | string
  reason?: string | null
  errorText?: string | null
  occurrenceKey?: string | null
  scheduledFor?: number | string | null
  startedAt?: number | string | null
  finishedAt?: number | string | null
  createdAt?: number | string | null
  chatSessionId?: string | null
  backendRunId?: string | null
}

export interface AutomationArtifact {
  id: string
  automationId?: string
  definitionId?: string
  runId?: string | null
  title?: string | null
  name?: string | null
  kind?: string | null
  mediaType?: string | null
  content?: string | null
  metadata?: Record<string, unknown> | null
  createdAt?: number | string | null
}

export interface AutomationDefinitionSummary extends AutomationDefinition {
  latestRun?: AutomationRun | null
}
