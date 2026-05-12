// AI SDK Engine — unified agent execution using Vercel AI SDK streamText
// Yields UIMessageChunk directly — no intermediate timeline abstraction
// Position: apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts

import { stepCountIs, streamText } from 'ai'
import type { LanguageModel, ModelMessage, ToolSet, UIMessageChunk } from 'ai'

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AiSdkEngineInput {
  model: LanguageModel
  messages: ModelMessage[]
  system?: string
  tools?: ToolSet
  maxSteps?: number
  abortSignal: AbortSignal
  providerOptions?: {
    thinkingEffort?: 'low' | 'medium' | 'high'
  }
  /** Callback to receive usage data when available */
  onUsage?: (usage: TokenUsage) => void
}

/**
 * Execute an AI SDK agent turn, yielding UIMessageChunk directly.
 *
 * Uses AI SDK's `streamText` + `toUIMessageStream()` to get native
 * UIMessageChunk events — no custom timeline abstraction needed.
 */
export async function* executeAiSdkTurn(input: AiSdkEngineInput): AsyncGenerator<UIMessageChunk, void, void> {
  const {
    model,
    messages,
    system,
    tools,
    maxSteps = 1,
    abortSignal,
    onUsage,
  } = input

  const result = streamText({
    model,
    messages,
    system,
    tools,
    stopWhen: maxSteps > 1 ? stepCountIs(maxSteps) : undefined,
    abortSignal,
  })

  // Use toUIMessageStream() to get native UIMessageChunk events
  const uiStream = result.toUIMessageStream()

  for await (const chunk of uiStream) {
    // Explicit abort check — needed because in-memory streams don't auto-abort
    if (abortSignal.aborted) {
      const err = new Error('AI SDK turn aborted')
      err.name = 'AbortError'
      throw err
    }

    yield chunk
  }

  // Extract usage after stream completes
  if (onUsage) {
    try {
      const usage = await result.usage
      if (usage) {
        onUsage({
          promptTokens: usage.inputTokens ?? 0,
          completionTokens: usage.outputTokens ?? 0,
          totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
        })
      }
    }
    catch {
      // Usage extraction failure is non-fatal
    }
  }
}

/**
 * Build ModelMessage array from our internal history format.
 */
export function buildModelMessages(
  history: Array<{ role: 'user' | 'assistant', content: string }> | undefined,
  message: string,
  maxMessages = 50,
): ModelMessage[] {
  const result: ModelMessage[] = []

  if (history && history.length > 0) {
    const effective = history.length > maxMessages
      ? history.slice(-maxMessages)
      : history

    // Ensure first message is from user (not assistant)
    const startIdx = effective[0]?.role === 'assistant' ? 1 : 0
    for (let i = startIdx; i < effective.length; i++) {
      result.push({ role: effective[i]!.role, content: effective[i]!.content })
    }
  }

  result.push({ role: 'user', content: message })
  return result
}
