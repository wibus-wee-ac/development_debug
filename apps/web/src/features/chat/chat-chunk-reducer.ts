// Input: UIMessageChunk sequences from hydration, live SSE, and subagent replay
// Output: Pure assistant chunk reducer + replay helpers producing canonical UIMessage parts
// Position: Feature-owned protocol adapter for chat chunk materialization

import type { UIMessage, UIMessageChunk } from 'ai'

type AssistantMessagePart = UIMessage['parts'][number]

type AssistantTextPart = {
  type: 'text'
  text: string
  providerMetadata?: unknown
}

type AssistantReasoningPart = {
  type: 'reasoning'
  text: string
  reasoning?: string
  details?: Array<{ type: 'text', text: string }>
  state?: 'streaming' | 'done'
}

type AssistantToolPart = {
  type: 'dynamic-tool'
  toolCallId: string
  toolName: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
  callProviderMetadata?: unknown
}

export interface AssistantChunkProjection {
  parts: AssistantMessagePart[]
  activeTextPartIndex: number | null
  activeReasoningPartIndex: number | null
  toolPartIndices: ReadonlyMap<string, number>
}

export function createAssistantChunkProjection(): AssistantChunkProjection {
  return {
    parts: [],
    activeTextPartIndex: null,
    activeReasoningPartIndex: null,
    toolPartIndices: new Map(),
  }
}

export function applyAssistantChunk(
  state: AssistantChunkProjection,
  chunk: UIMessageChunk,
): AssistantChunkProjection {
  switch (chunk.type) {
    case 'text-start': {
      const meta = (chunk as { providerMetadata?: Record<string, unknown> }).providerMetadata
      const textPart: AssistantTextPart = meta
        ? { type: 'text', text: '', providerMetadata: meta }
        : { type: 'text', text: '' }
      const parts = [...state.parts, textPart as AssistantMessagePart]
      return {
        ...state,
        parts,
        activeTextPartIndex: parts.length - 1,
      }
    }

    case 'text-delta': {
      const delta = (chunk as { delta: string }).delta
      const activeIndex = state.activeTextPartIndex
      if (activeIndex !== null) {
        const currentPart = state.parts[activeIndex]
        if (currentPart?.type === 'text') {
          return {
            ...state,
            parts: replacePart(state.parts, activeIndex, {
              ...(currentPart as AssistantTextPart),
              text: currentPart.text + delta,
            } as AssistantMessagePart),
          }
        }
      }

      const parts = [...state.parts, { type: 'text', text: delta } as AssistantMessagePart]
      return {
        ...state,
        parts,
        activeTextPartIndex: parts.length - 1,
      }
    }

    case 'text-end':
      if (state.activeTextPartIndex === null) {
        return state
      }
      return { ...state, activeTextPartIndex: null }

    case 'reasoning-start': {
      const reasoningPart: AssistantReasoningPart = {
        type: 'reasoning',
        text: '',
        reasoning: '',
        details: [{ type: 'text', text: '' }],
        state: 'streaming',
      }
      const parts = [...state.parts, reasoningPart as AssistantMessagePart]
      return {
        ...state,
        parts,
        activeReasoningPartIndex: parts.length - 1,
      }
    }

    case 'reasoning-delta': {
      const activeIndex = state.activeReasoningPartIndex
      if (activeIndex === null) {
        return state
      }

      const currentPart = state.parts[activeIndex]
      if (currentPart?.type !== 'reasoning') {
        return state
      }

      const delta = (chunk as { delta: string }).delta
      const reasoningPart = currentPart as AssistantReasoningPart
      const currentDetails = reasoningPart.details ?? []
      const nextDetails = currentDetails.length > 0
        ? [{ ...currentDetails[0]!, text: (currentDetails[0]?.text ?? '') + delta }, ...currentDetails.slice(1)]
        : [{ type: 'text' as const, text: delta }]

      return {
        ...state,
        parts: replacePart(state.parts, activeIndex, {
          ...reasoningPart,
          text: reasoningPart.text + delta,
          reasoning: (reasoningPart.reasoning ?? '') + delta,
          details: nextDetails,
        } as AssistantMessagePart),
      }
    }

    case 'reasoning-end': {
      const activeIndex = state.activeReasoningPartIndex
      if (activeIndex === null) {
        return state
      }

      const currentPart = state.parts[activeIndex]
      if (currentPart?.type !== 'reasoning') {
        return { ...state, activeReasoningPartIndex: null }
      }

      return {
        ...state,
        parts: replacePart(state.parts, activeIndex, {
          ...(currentPart as AssistantReasoningPart),
          state: 'done',
        } as AssistantMessagePart),
        activeReasoningPartIndex: null,
      }
    }

    case 'tool-input-start': {
      const toolChunk = chunk as {
        toolCallId: string
        toolName: string
        providerMetadata?: Record<string, unknown>
      }
      const toolPart: AssistantToolPart = {
        type: 'dynamic-tool',
        toolCallId: toolChunk.toolCallId,
        toolName: toolChunk.toolName,
        state: 'input-streaming',
        input: undefined,
      }
      if (toolChunk.providerMetadata) {
        toolPart.callProviderMetadata = toolChunk.providerMetadata
      }

      const parts = [...state.parts, toolPart as AssistantMessagePart]
      const toolPartIndices = new Map(state.toolPartIndices)
      toolPartIndices.set(toolChunk.toolCallId, parts.length - 1)

      return {
        ...state,
        parts,
        toolPartIndices,
      }
    }

    case 'tool-input-available':
      return updateToolPart(state, chunk as { toolCallId: string, input: unknown }, (toolPart, toolChunk) => ({
        ...toolPart,
        state: 'input-available',
        input: toolChunk.input,
      }))

    case 'tool-input-error':
      return updateToolPart(state, chunk as { toolCallId: string, input: unknown, errorText: string }, (toolPart, toolChunk) => ({
        ...toolPart,
        state: 'output-error',
        input: toolChunk.input,
        errorText: toolChunk.errorText,
      }))

    case 'tool-output-available':
      return updateToolPart(state, chunk as { toolCallId: string, output: unknown }, (toolPart, toolChunk) => ({
        ...toolPart,
        state: 'output-available',
        output: toolChunk.output,
      }))

    case 'abort':
    case 'error':
    case 'finish':
    default:
      return state
  }
}

export function applyAssistantChunks(
  state: AssistantChunkProjection,
  chunks: UIMessageChunk[],
): AssistantChunkProjection {
  return chunks.reduce(applyAssistantChunk, state)
}

export function replayAssistantChunks(chunks: UIMessageChunk[]): AssistantMessagePart[] {
  return applyAssistantChunks(createAssistantChunkProjection(), chunks).parts
}

export function projectAssistantMessageFromChunks(messageId: string, chunks: UIMessageChunk[]): UIMessage {
  return {
    id: messageId,
    role: 'assistant',
    parts: replayAssistantChunks(chunks),
  }
}

function replacePart(parts: AssistantMessagePart[], index: number, part: AssistantMessagePart): AssistantMessagePart[] {
  const next = [...parts]
  next[index] = part
  return next
}

function updateToolPart<TChunk extends { toolCallId: string }>(
  state: AssistantChunkProjection,
  chunk: TChunk,
  updater: (toolPart: AssistantToolPart, chunk: TChunk) => AssistantToolPart,
): AssistantChunkProjection {
  const indexedPosition = state.toolPartIndices.get(chunk.toolCallId)
  const fallbackPosition = indexedPosition ?? findToolPartIndex(state.parts, chunk.toolCallId)
  if (fallbackPosition === -1 || fallbackPosition === undefined) {
    return state
  }

  const currentPart = state.parts[fallbackPosition]
  if (currentPart?.type !== 'dynamic-tool') {
    return state
  }

  const nextPart = updater(currentPart as AssistantToolPart, chunk)
  const toolPartIndices = indexedPosition === undefined
    ? new Map(state.toolPartIndices).set(chunk.toolCallId, fallbackPosition)
    : state.toolPartIndices

  return {
    ...state,
    parts: replacePart(state.parts, fallbackPosition, nextPart as AssistantMessagePart),
    toolPartIndices,
  }
}

function findToolPartIndex(parts: AssistantMessagePart[], toolCallId: string): number {
  return parts.findIndex(
    part => part.type === 'dynamic-tool' && (part as AssistantToolPart).toolCallId === toolCallId,
  )
}
