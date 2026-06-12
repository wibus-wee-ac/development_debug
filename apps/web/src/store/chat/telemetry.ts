import type { UIMessage } from 'ai'
import isEqual from 'fast-deep-equal'

import type { ChatState } from './types'
import { EMPTY_MESSAGES, DEFAULT_SESSION_META } from './types'
import type { ChatActiveGoal } from './types'

// ── Telemetry (diagnostic snapshot) ──────────────────────────

const TELEMETRY_SESSION_LIMIT = 20
const TELEMETRY_DEPTH_LIMIT = 6
const TELEMETRY_ENTRY_LIMIT = 200

interface SessionTelemetry {
  sessionId: string
  hydrated: boolean
  messageCount: number
  partCount: number
  textPartCount: number
  toolPartCount: number
  filePartCount: number
  dataPartCount: number
  reasoningPartCount: number
  estimatedPartStringChars: number
  streamingMessageCount: number
  generatingMessageCount: number
  passiveStreamingMessageCount: number
  hasLocalDriver: boolean
  passiveStatus: string
  errorCount: number
  activeGoal: boolean
  assistantDisplaySplitCount: number
}

interface ActiveStreamingMessage {
  sessionId: string
  messageId: string
  generating: boolean
  passiveStreaming: boolean
  localDriver: boolean
  role: string
  partCount: number
  estimatedPartStringChars: number
}

export interface ChatStoreTelemetrySnapshot {
  totals: {
    sessionCount: number
    hydratedSessionCount: number
    messageCount: number
    partCount: number
    textPartCount: number
    toolPartCount: number
    filePartCount: number
    dataPartCount: number
    reasoningPartCount: number
    estimatedPartStringChars: number
    generatingMessageCount: number
    passiveStreamingMessageCount: number
    activeAbortControllerCount: number
    runDisplayMetaCount: number
    errorCount: number
    sessionMetaCount: number
    activeGoalCount: number
    assistantDisplaySplitCount: number
  }
  sessions: SessionTelemetry[]
  limits: { sessionLimit: number, truncatedSessions: number }
  activeStreamingMessages: ActiveStreamingMessage[]
}

export function getChatStoreTelemetrySnapshot(state: ChatState): ChatStoreTelemetrySnapshot {
  const splitCounts = countSplitsBySession(state)
  const totals = {
    sessionCount: state.messagesMap.size,
    hydratedSessionCount: state.hydratedSessionIds.size,
    messageCount: 0,
    partCount: 0,
    textPartCount: 0,
    toolPartCount: 0,
    filePartCount: 0,
    dataPartCount: 0,
    reasoningPartCount: 0,
    estimatedPartStringChars: 0,
    generatingMessageCount: state.generatingMessageIds.size,
    passiveStreamingMessageCount: state.passiveStreamingMessageIds.size,
    activeAbortControllerCount: state.activeAbortControllers.size,
    runDisplayMetaCount: state.runDisplayMetaMap.size,
    errorCount: state.errorMap.size,
    sessionMetaCount: state.sessionMetaMap.size,
    activeGoalCount: state.activeGoalMap.size,
    assistantDisplaySplitCount: state.assistantDisplaySplitMap.size,
  }

  const sessions: SessionTelemetry[] = []

  for (const [sessionId, messages] of state.messagesMap) {
    const meta = state.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
    const session: SessionTelemetry = {
      sessionId,
      hydrated: state.hydratedSessionIds.has(sessionId),
      messageCount: messages.length,
      partCount: 0, textPartCount: 0, toolPartCount: 0,
      filePartCount: 0, dataPartCount: 0, reasoningPartCount: 0,
      estimatedPartStringChars: 0, streamingMessageCount: 0,
      generatingMessageCount: 0, passiveStreamingMessageCount: 0,
      hasLocalDriver: Boolean(meta.localDriverMessageId),
      passiveStatus: meta.passiveStatus,
      errorCount: 0, activeGoal: state.activeGoalMap.has(sessionId),
      assistantDisplaySplitCount: splitCounts.get(sessionId) ?? 0,
    }

    for (const message of messages) {
      if (state.errorMap.has(message.id)) session.errorCount++
      const gen = state.generatingMessageIds.has(message.id)
      const passive = state.passiveStreamingMessageIds.has(message.id)
      if (gen) session.generatingMessageCount++
      if (passive) session.passiveStreamingMessageCount++
      if (gen || passive || meta.localDriverMessageId === message.id) session.streamingMessageCount++

      for (const part of message.parts) {
        session.partCount++
        session.estimatedPartStringChars += estimateChars(part)
        const t = (part as { type: string }).type
        if (t === 'text') session.textPartCount++
        else if (t === 'file') session.filePartCount++
        else if (t === 'reasoning' || t.startsWith('reasoning-')) session.reasoningPartCount++
        else if (t.startsWith('tool-') || t === 'dynamic-tool') session.toolPartCount++
        else if (t.startsWith('data-')) session.dataPartCount++
      }
    }

    totals.messageCount += session.messageCount
    totals.partCount += session.partCount
    totals.textPartCount += session.textPartCount
    totals.toolPartCount += session.toolPartCount
    totals.filePartCount += session.filePartCount
    totals.dataPartCount += session.dataPartCount
    totals.reasoningPartCount += session.reasoningPartCount
    totals.estimatedPartStringChars += session.estimatedPartStringChars
    sessions.push(session)
  }

  sessions.sort((a, b) => b.estimatedPartStringChars - a.estimatedPartStringChars || b.messageCount - a.messageCount)

  return {
    totals,
    sessions: sessions.slice(0, TELEMETRY_SESSION_LIMIT),
    limits: { sessionLimit: TELEMETRY_SESSION_LIMIT, truncatedSessions: Math.max(0, sessions.length - TELEMETRY_SESSION_LIMIT) },
    activeStreamingMessages: getActiveStreaming(state),
  }
}

function getActiveStreaming(state: ChatState): ActiveStreamingMessage[] {
  const result: ActiveStreamingMessage[] = []
  for (const [sessionId, messages] of state.messagesMap) {
    const meta = state.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
    for (const msg of messages) {
      const gen = state.generatingMessageIds.has(msg.id)
      const passive = state.passiveStreamingMessageIds.has(msg.id)
      const local = meta.localDriverMessageId === msg.id
      if (gen || passive || local) {
        result.push({ sessionId, messageId: msg.id, generating: gen, passiveStreaming: passive, localDriver: local, role: msg.role, partCount: msg.parts.length, estimatedPartStringChars: msg.parts.reduce((t, p) => t + estimateChars(p), 0) })
      }
    }
    if (meta.localDriverMessageId && !messages.some(m => m.id === meta.localDriverMessageId)) {
      result.push({ sessionId, messageId: meta.localDriverMessageId, generating: state.generatingMessageIds.has(meta.localDriverMessageId), passiveStreaming: state.passiveStreamingMessageIds.has(meta.localDriverMessageId), localDriver: true, role: 'unknown', partCount: 0, estimatedPartStringChars: 0 })
    }
  }
  return result
}

function countSplitsBySession(state: ChatState): Map<string, number> {
  const msgSession = new Map<string, string>()
  for (const [sid, msgs] of state.messagesMap) {
    for (const m of msgs) msgSession.set(m.id, sid)
  }
  const counts = new Map<string, number>()
  for (const split of state.assistantDisplaySplitMap.values()) {
    const sid = msgSession.get(split.sourceMessageId) ?? msgSession.get(split.tailMessageId)
    if (sid) counts.set(sid, (counts.get(sid) ?? 0) + 1)
  }
  return counts
}

function estimateChars(value: unknown, depth = 0, seen = new Set<object>()): number {
  if (typeof value === 'string') return value.length
  if (!value || typeof value !== 'object' || seen.has(value) || depth >= TELEMETRY_DEPTH_LIMIT) return 0
  seen.add(value)
  let total = 0
  const entries = Array.isArray(value) ? value : Object.values(value)
  for (const item of entries.slice(0, TELEMETRY_ENTRY_LIMIT)) {
    total += estimateChars(item, depth + 1, seen)
  }
  seen.delete(value)
  return total
}
