// Input: ProviderKind from agent runtime and durable control-plane persistence requirements
// Output: Backend control-plane entities, store interfaces, and application service input types
// Position: Type contract for Cradle-owned backend binding/run/capability semantics

import type { ProviderKind } from '../agent-runtime/runtime-provider-types'

export interface BackendSessionBinding {
  id: string
  chatSessionId: string
  agentProfileId: string
  providerKind: ProviderKind
  backendSessionId: string | null
  backendStateSnapshot: string | null
  requestedModelId: string | null
  configSnapshot: string | null
  createdAt: number
  updatedAt: number
}

export interface BackendRun {
  id: string
  bindingId: string
  chatSessionId: string
  messageId: string | null
  origin: 'user' | 'issue-agent' | 'system'
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  stopReason: string | null
  errorText: string | null
  startedAt: number
  finishedAt: number | null
}

export interface BackendCapabilitySnapshot {
  id: string
  agentProfileId: string
  providerKind: ProviderKind
  source: 'probe' | 'session_start'
  capabilitiesJson: string
  recordedAt: number
}

export interface AttachBackendBindingInput {
  chatSessionId: string
  agentProfileId: string
  providerKind: ProviderKind
  backendSessionId: string | null
  backendStateSnapshot: string | null
  requestedModelId: string | null
  configSnapshot: string | null
}

export interface StartBackendRunInput {
  chatSessionId: string
  messageId: string | null
  origin: 'user' | 'issue-agent' | 'system'
}

export interface FinishBackendRunInput {
  runId: string
  status: BackendRun['status']
  stopReason?: string | null
  errorText?: string | null
}

export interface RecordBackendCapabilitySnapshotInput {
  agentProfileId: string
  providerKind: ProviderKind
  source: BackendCapabilitySnapshot['source']
  capabilitiesJson: string
}

export interface BackendControlPlaneStore {
  getBindingByChatSessionId: (chatSessionId: string) => BackendSessionBinding | undefined
  listBindingsByBackendSessionId: (backendSessionId: string) => BackendSessionBinding[]
  upsertBinding: (input: AttachBackendBindingInput) => BackendSessionBinding
  createRun: (input: StartBackendRunInput & { bindingId: string }) => BackendRun
  updateRun: (input: FinishBackendRunInput) => BackendRun
  insertCapabilitySnapshot: (input: RecordBackendCapabilitySnapshotInput) => BackendCapabilitySnapshot
}

export interface BackendControlPlaneService {
  getBinding: (chatSessionId: string) => BackendSessionBinding | undefined
  listBindingsByBackendSessionId: (backendSessionId: string) => BackendSessionBinding[]
  attachBinding: (input: AttachBackendBindingInput) => BackendSessionBinding
  startRun: (input: StartBackendRunInput) => BackendRun
  finishRun: (input: FinishBackendRunInput) => BackendRun
  recordCapabilitySnapshot: (input: RecordBackendCapabilitySnapshotInput) => BackendCapabilitySnapshot
}

export interface BackendCapabilityRecorder {
  recordCapabilitySnapshot: (input: RecordBackendCapabilitySnapshotInput) => BackendCapabilitySnapshot | void
}
