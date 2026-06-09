import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'

import {
  backendRuns,
  backendSessionBindings,
  chatSessionQueueItems,
  messages,
  sessions,
} from '@cradle/db'

import { db } from '../../infra'
import { currentUnixSeconds } from '../../helpers/time'
import type { ChatRuntimeEventRecord } from './events'
import { isTerminalRunEventType } from './events'
import { foldChatRuntimeEvents, type ChatRuntimeFoldState } from './event-fold'
import { readReplayTextMessages, readText } from './replay/event-content'

export interface ProjectChatRuntimeReadModelsResult {
  state: ChatRuntimeFoldState
  counts: {
    bindings: number
    runs: number
    messages: number
    queueItems: number
  }
}

export function projectChatRuntimeReadModels(input: {
  streamId: string
  events: ChatRuntimeEventRecord[]
}): ProjectChatRuntimeReadModelsResult {
  const state = foldChatRuntimeEvents(input.streamId, input.events)
  const relevantEvents = input.events.filter(event => event.streamId === input.streamId)

  return db().transaction((tx) => {
    const bindingId = readExistingBindingId(tx, input.streamId)
    const messageCount = projectMessages(tx, input.streamId, state, relevantEvents)
    const runCount = projectRuns(tx, input.streamId, state, bindingId, relevantEvents)
    const queueCount = projectQueueItems(tx, input.streamId, state)

    const updatedAt = readLatestOccurredAt(relevantEvents)
    if (updatedAt) {
      tx.update(sessions).set({ updatedAt }).where(eq(sessions.id, input.streamId)).run()
    }

    return {
      state,
      counts: {
        bindings: 0,
        runs: runCount,
        messages: messageCount,
        queueItems: queueCount,
      },
    }
  })
}

type ProjectorTx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0]

function readExistingBindingId(
  tx: ProjectorTx,
  streamId: string,
): string | null {
  return tx
    .select({ id: backendSessionBindings.id })
    .from(backendSessionBindings)
    .where(eq(backendSessionBindings.chatSessionId, streamId))
    .get()?.id ?? null
}

function projectMessages(
  tx: ProjectorTx,
  streamId: string,
  state: ChatRuntimeFoldState,
  events: ChatRuntimeEventRecord[],
): number {
  let count = 0
  for (const message of state.messages.values()) {
    const snapshot = readMessageSnapshot(message.id, message.role, message.payload, events)
    const now = readMessageUpdatedAt(message.id, events) ?? message.createdAt
    const content = readTextFromSnapshot(snapshot) || readText(message.payload)
    tx.insert(messages)
      .values({
        id: message.id,
        sessionId: streamId,
        parentMessageId: readNullableString(message.payload.parentMessageId),
        parentToolCallId: readNullableString(message.payload.parentToolCallId),
        taskId: readNullableString(message.payload.taskId),
        depth: readFiniteNumber(message.payload.depth) ?? 0,
        role: message.role,
        status: message.status,
        content,
        messageJson: stringifyJson(snapshot),
        errorText: readNullableString(message.payload.errorText),
        createdAt: message.createdAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: messages.id,
        set: {
          sessionId: streamId,
          parentMessageId: readNullableString(message.payload.parentMessageId),
          parentToolCallId: readNullableString(message.payload.parentToolCallId),
          taskId: readNullableString(message.payload.taskId),
          depth: readFiniteNumber(message.payload.depth) ?? 0,
          role: message.role,
          status: message.status,
          content,
          messageJson: stringifyJson(snapshot),
          errorText: readNullableString(message.payload.errorText),
          updatedAt: now,
        },
      })
      .run()
    count += 1
  }
  return count
}

function projectRuns(
  tx: ProjectorTx,
  streamId: string,
  state: ChatRuntimeFoldState,
  bindingId: string | null,
  events: ChatRuntimeEventRecord[],
): number {
  let count = 0
  for (const run of state.runs.values()) {
    const startEvent = events.find(event => event.runId === run.id && event.type === 'run.started')
    const terminalEvent = events.find(event => event.runId === run.id && isTerminalRunEventType(event.type))
    const origin = readRunOrigin(startEvent?.payload ?? terminalEvent?.payload ?? {})
    tx.insert(backendRuns)
      .values({
        id: run.id,
        bindingId,
        chatSessionId: streamId,
        messageId: run.messageId,
        origin,
        status: run.status,
        stopReason: readNullableString(terminalEvent?.payload.stopReason),
        errorText: run.errorText,
        startedAt: run.startedAt ?? startEvent?.occurredAt ?? terminalEvent?.occurredAt ?? readLatestOccurredAt(events) ?? currentUnixSeconds(),
        finishedAt: run.finishedAt,
      })
      .onConflictDoUpdate({
        target: backendRuns.id,
        set: {
          bindingId,
          chatSessionId: streamId,
          messageId: run.messageId,
          origin,
          status: run.status,
          stopReason: readNullableString(terminalEvent?.payload.stopReason),
          errorText: run.errorText,
          finishedAt: run.finishedAt,
        },
      })
      .run()
    count += 1
  }
  return count
}

function projectQueueItems(
  tx: ProjectorTx,
  streamId: string,
  state: ChatRuntimeFoldState,
): number {
  let count = 0
  for (const item of state.queue.values()) {
    tx.insert(chatSessionQueueItems)
      .values({
        id: item.id,
        sessionId: streamId,
        mode: 'queue',
        status: item.status,
        text: readString(item.payload.text) ?? '',
        filesJson: stringifyJson(readArray(item.payload.files)),
        contextPartsJson: stringifyJson(readArray(item.payload.contextParts)),
        providerTargetId: readNullableString(item.payload.providerTargetId),
        modelId: readNullableString(item.payload.modelId),
        thinkingEffort: readThinkingEffort(item.payload.thinkingEffort),
        permissionMode: readPermissionMode(item.payload.permissionMode),
        runtimeAccessMode: readRuntimeAccessMode(item.payload.runtimeAccessMode),
        runtimeInteractionMode: readRuntimeInteractionMode(item.payload.runtimeInteractionMode),
        position: item.position ?? 0,
        sourceRunId: readNullableString(item.payload.sourceRunId),
        startedRunId: item.runId,
        errorText: readNullableString(item.payload.errorText),
        createdAt: readFiniteNumber(item.payload.createdAt) ?? currentUnixSeconds(),
        updatedAt: readFiniteNumber(item.payload.updatedAt) ?? currentUnixSeconds(),
      })
      .onConflictDoUpdate({
        target: chatSessionQueueItems.id,
        set: {
          sessionId: streamId,
          mode: 'queue',
          status: item.status,
          text: readString(item.payload.text) ?? '',
          filesJson: stringifyJson(readArray(item.payload.files)),
          contextPartsJson: stringifyJson(readArray(item.payload.contextParts)),
          providerTargetId: readNullableString(item.payload.providerTargetId),
          modelId: readNullableString(item.payload.modelId),
          thinkingEffort: readThinkingEffort(item.payload.thinkingEffort),
          permissionMode: readPermissionMode(item.payload.permissionMode),
          runtimeAccessMode: readRuntimeAccessMode(item.payload.runtimeAccessMode),
          runtimeInteractionMode: readRuntimeInteractionMode(item.payload.runtimeInteractionMode),
          position: item.position ?? 0,
          sourceRunId: readNullableString(item.payload.sourceRunId),
          startedRunId: item.runId,
          errorText: readNullableString(item.payload.errorText),
        },
      })
      .run()
    count += 1
  }
  return count
}

function readMessageSnapshot(
  messageId: string,
  role: 'user' | 'assistant',
  payload: Record<string, unknown>,
  events: ChatRuntimeEventRecord[],
): UIMessage {
  const message = readRecord(payload.message)
  if (message && typeof message.id === 'string' && Array.isArray(message.parts)) {
    return message as unknown as UIMessage
  }

  const snapshot = readRecord(payload.snapshot)
  if (snapshot && typeof snapshot.id === 'string' && Array.isArray(snapshot.parts)) {
    return snapshot as unknown as UIMessage
  }

  const latestText = readReplayTextMessages(events)
    .filter(candidate => candidate.role === role && candidate.messageId === messageId)
    .at(-1)?.content ?? readText(payload)

  return {
    id: messageId,
    role,
    parts: latestText ? [{ type: 'text', text: latestText }] : [],
  } as UIMessage
}

function readTextFromSnapshot(message: UIMessage): string {
  return message.parts
    .flatMap(part => part.type === 'text' ? [part.text] : [])
    .join('')
}

function readMessageUpdatedAt(messageId: string, events: ChatRuntimeEventRecord[]): number | null {
  const matching = events.filter(event => event.messageId === messageId)
  return readLatestOccurredAt(matching)
}

function readLatestOccurredAt(events: ChatRuntimeEventRecord[]): number | null {
  return events.reduce<number | null>((latest, event) => {
    if (latest === null || event.occurredAt > latest) {
      return event.occurredAt
    }
    return latest
  }, null)
}

function readRunOrigin(payload: Record<string, unknown>): 'user' | 'issue-agent' | 'system' {
  return payload.origin === 'issue-agent' || payload.origin === 'system' ? payload.origin : 'user'
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readThinkingEffort(value: unknown): 'low' | 'medium' | 'high' | 'xhigh' | null {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
    ? value
    : null
}

function readPermissionMode(value: unknown): 'bypassPermissions' | 'plan' | null {
  return value === 'bypassPermissions' || value === 'plan' ? value : null
}

function readRuntimeAccessMode(value: unknown): 'approval-required' | 'full-access' | null {
  return value === 'approval-required' || value === 'full-access' ? value : null
}

function readRuntimeInteractionMode(value: unknown): 'default' | 'plan' | null {
  return value === 'default' || value === 'plan' ? value : null
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {})
  }
  catch {
    return JSON.stringify({ unserializable: true })
  }
}
