// Input: backend control-plane feature service and durable control-plane types
// Output: Behavior tests for binding upserts, run lifecycle, and capability snapshot recording
// Position: Feature-level regression suite for src/main/features/backend-control-plane/backend-control-plane.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../db', () => ({
  getDb: vi.fn(),
}))

import type {
  AttachBackendBindingInput,
  BackendCapabilitySnapshot,
  BackendControlPlaneStore,
  BackendRun,
  BackendSessionBinding,
  BackendTimelineEvent,
  FinishBackendRunInput,
  RecordBackendCapabilitySnapshotInput,
  StartBackendRunInput,
} from '../types'
import { createBackendControlPlaneService } from '../backend-control-plane'

class MemoryBackendControlPlaneStore implements BackendControlPlaneStore {
  readonly bindings = new Map<string, BackendSessionBinding>()
  readonly runs = new Map<string, BackendRun>()
  readonly capabilitySnapshots: BackendCapabilitySnapshot[] = []
  readonly timelineEvents = new Map<string, BackendTimelineEvent[]>()

  getBindingByChatSessionId(chatSessionId: string): BackendSessionBinding | undefined {
    return this.bindings.get(chatSessionId)
  }

  listBindingsByBackendSessionId(backendSessionId: string): BackendSessionBinding[] {
    return [...this.bindings.values()].filter(binding => binding.backendSessionId === backendSessionId)
  }

  upsertBinding(input: AttachBackendBindingInput): BackendSessionBinding {
    const now = 1_700_000_000
    const existing = this.bindings.get(input.chatSessionId)
    const binding: BackendSessionBinding = {
      id: existing?.id ?? `binding-${input.chatSessionId}`,
      chatSessionId: input.chatSessionId,
      agentProfileId: input.agentProfileId,
      providerKind: input.providerKind,
      backendSessionId: input.backendSessionId,
      backendStateSnapshot: input.backendStateSnapshot,
      requestedModelId: input.requestedModelId,
      configSnapshot: input.configSnapshot,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.bindings.set(input.chatSessionId, binding)
    return binding
  }

  createRun(input: StartBackendRunInput & { bindingId: string }): BackendRun {
    const run: BackendRun = {
      id: `run-${this.runs.size + 1}`,
      bindingId: input.bindingId,
      chatSessionId: input.chatSessionId,
      messageId: input.messageId,
      origin: input.origin,
      status: 'streaming',
      stopReason: null,
      errorText: null,
      startedAt: 1_700_000_000,
      finishedAt: null,
    }
    this.runs.set(run.id, run)
    return run
  }

  updateRun(input: FinishBackendRunInput): BackendRun {
    const existing = this.runs.get(input.runId)
    if (!existing) {
      throw new Error(`Run not found: ${input.runId}`)
    }
    const run: BackendRun = {
      ...existing,
      status: input.status,
      stopReason: input.stopReason ?? null,
      errorText: input.errorText ?? null,
      finishedAt: 1_700_000_100,
    }
    this.runs.set(run.id, run)
    return run
  }

  insertCapabilitySnapshot(input: RecordBackendCapabilitySnapshotInput): BackendCapabilitySnapshot {
    const snapshot: BackendCapabilitySnapshot = {
      id: `snapshot-${this.capabilitySnapshots.length + 1}`,
      agentProfileId: input.agentProfileId,
      providerKind: input.providerKind,
      source: input.source,
      capabilitiesJson: input.capabilitiesJson,
      recordedAt: 1_700_000_000,
    }
    this.capabilitySnapshots.push(snapshot)
    return snapshot
  }

  getLastTimelineEvent(runId: string): BackendTimelineEvent | undefined {
    return this.timelineEvents.get(runId)?.at(-1)
  }

  insertTimelineEvent(event: BackendTimelineEvent): BackendTimelineEvent {
    const existing = this.timelineEvents.get(event.runId) ?? []
    existing.push(event)
    this.timelineEvents.set(event.runId, existing)
    return event
  }

  listTimelineEventsByRunId(runId: string): BackendTimelineEvent[] {
    return this.timelineEvents.get(runId) ?? []
  }
}

describe('backendControlPlaneService', () => {
  let store: MemoryBackendControlPlaneStore

  beforeEach(() => {
    store = new MemoryBackendControlPlaneStore()
  })

  it('attaches one durable binding per chat session', () => {
    const service = createBackendControlPlaneService({ store })

    const first = service.attachBinding({
      chatSessionId: 'chat-1',
      agentProfileId: 'profile-1',
      providerKind: 'acp-chat',
      backendSessionId: 'backend-1',
      backendStateSnapshot: '{"phase":"first"}',
      requestedModelId: 'claude-4',
      configSnapshot: '[{"id":"thinking","currentValue":"high"}]',
    })
    const second = service.attachBinding({
      chatSessionId: 'chat-1',
      agentProfileId: 'profile-1',
      providerKind: 'acp-chat',
      backendSessionId: 'backend-2',
      backendStateSnapshot: '{"phase":"second"}',
      requestedModelId: 'claude-4.1',
      configSnapshot: '[{"id":"thinking","currentValue":"medium"}]',
    })

    expect(first.id).toBe(second.id)
    expect(store.bindings.size).toBe(1)
    expect(store.getBindingByChatSessionId('chat-1')).toEqual(
      expect.objectContaining({
        backendSessionId: 'backend-2',
        requestedModelId: 'claude-4.1',
      }),
    )
  })

  it('creates a streaming run and marks it complete', () => {
    const service = createBackendControlPlaneService({ store })
    service.attachBinding({
      chatSessionId: 'chat-1',
      agentProfileId: 'profile-1',
      providerKind: 'openai-compatible',
      backendSessionId: null,
      backendStateSnapshot: null,
      requestedModelId: 'gpt-5',
      configSnapshot: null,
    })

    const run = service.startRun({
      chatSessionId: 'chat-1',
      messageId: 'message-1',
      origin: 'user',
    })
    const completed = service.finishRun({
      runId: run.id,
      status: 'complete',
      stopReason: 'response.completed',
    })

    expect(run.status).toBe('streaming')
    expect(completed).toEqual(
      expect.objectContaining({
        id: run.id,
        status: 'complete',
        stopReason: 'response.completed',
      }),
    )
  })

  it('preserves failed runs and records the error text', () => {
    const service = createBackendControlPlaneService({ store })
    service.attachBinding({
      chatSessionId: 'chat-2',
      agentProfileId: 'profile-1',
      providerKind: 'acp-chat',
      backendSessionId: 'backend-2',
      backendStateSnapshot: null,
      requestedModelId: null,
      configSnapshot: null,
    })

    const run = service.startRun({
      chatSessionId: 'chat-2',
      messageId: 'message-2',
      origin: 'user',
    })
    const failed = service.finishRun({
      runId: run.id,
      status: 'failed',
      errorText: 'backend exploded',
    })

    expect(store.runs.size).toBe(1)
    expect(failed).toEqual(
      expect.objectContaining({
        id: run.id,
        status: 'failed',
        errorText: 'backend exploded',
      }),
    )
  })

  it('records probe capability snapshots without needing a chat turn', () => {
    const service = createBackendControlPlaneService({ store })

    const snapshot = service.recordCapabilitySnapshot({
      agentProfileId: 'profile-1',
      providerKind: 'acp-chat',
      source: 'probe',
      capabilitiesJson: '{"models":["claude-4"]}',
    })

    expect(snapshot.source).toBe('probe')
    expect(store.capabilitySnapshots).toEqual([
      expect.objectContaining({
        agentProfileId: 'profile-1',
        capabilitiesJson: '{"models":["claude-4"]}',
      }),
    ])
  })

  it('appends typed timeline events with monotonically increasing sequence numbers', () => {
    const service = createBackendControlPlaneService({ store })
    service.attachBinding({
      chatSessionId: 'chat-3',
      agentProfileId: 'profile-1',
      providerKind: 'openai-compatible',
      backendSessionId: null,
      backendStateSnapshot: null,
      requestedModelId: 'gpt-5',
      configSnapshot: null,
    })

    const run = service.startRun({
      chatSessionId: 'chat-3',
      messageId: 'message-3',
      origin: 'user',
    })

    const started = service.appendTimelineEvent({
      chatSessionId: 'chat-3',
      runId: run.id,
      event: {
        type: 'run.started',
        source: {
          backend: 'openai-compatible',
          eventType: 'run.started',
        },
      },
    })
    const delta = service.appendTimelineEvent({
      chatSessionId: 'chat-3',
      runId: run.id,
      event: {
        type: 'assistant.text.delta',
        itemId: 'item-1',
        delta: 'Hello',
        source: {
          backend: 'openai-compatible',
          eventType: 'response.output_text.delta',
        },
      },
    })

    expect(started.sequenceNumber).toBe(0)
    expect(delta.sequenceNumber).toBe(1)
    expect(store.listTimelineEventsByRunId(run.id)).toHaveLength(2)
  })
})