// AI SDK Engine — unified agent execution using Vercel AI SDK streamText
// Yields UIMessageChunk directly — no intermediate timeline abstraction
// Position: apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts

import type { LanguageModel, ModelMessage, ToolSet, UIMessage, UIMessageChunk } from 'ai'
import { readUIMessageStream, stepCountIs, streamText } from 'ai'

import { langfuseEnabled } from '../../../langfuse'
import type { BudgetConfig } from '../../usage/budget'
import { checkDailyBudget, checkTurnBudget } from '../../usage/budget'
import { estimateCost } from '../../usage/pricing'
import { compactByWindow, compactWithSummary, isContextOverflow, resolveCompactionConfig } from './compaction'
import type { ToolApprovalContext } from './tool-approval-wrapper'
import { wrapToolsWithApproval } from './tool-approval-wrapper'

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AiSdkEngineInput {
  model: LanguageModel
  messages: ModelMessage[]
  initialMessage?: UIMessage
  system?: string
  tools?: ToolSet
  maxSteps?: number
  abortSignal?: AbortSignal
  abortController?: AbortController
  providerOptions?: {
    thinkingEffort?: 'low' | 'medium' | 'high'
  }
  /** Callback to receive usage data when available */
  onUsage?: (usage: TokenUsage) => void
  /** Callback for per-step usage data */
  onStepFinish?: (step: {
    stepNumber: number
    stepType: string
    modelId?: string
    usage: TokenUsage
  }) => void
  /** Tool approval context. When set, tools are wrapped with approval gates. */
  approvalContext?: ToolApprovalContext
  /** Context window of the model in tokens (for auto-compaction) */
  contextWindow?: number
  /** Compaction strategy: 'window' drops old messages, 'summarize' generates a summary first */
  compactionStrategy?: 'window' | 'summarize'
  /** Optional budget limits for cost control */
  budgetConfig?: BudgetConfig
  /** Called when a budget limit is exceeded (lets the caller decide how to handle it) */
  onBudgetExceeded?: (reason: string) => void
  /** Returns the current day's total cost (for daily budget checks) */
  getDailyCost?: () => number
  /** Chat session ID for Langfuse session correlation */
  chatSessionId?: string
}

function createAiSdkStreamResult(input: AiSdkEngineInput): {
  result: ReturnType<typeof streamText>
  effectiveAbortSignal: AbortSignal | undefined
} {
  const {
    model,
    messages,
    system,
    tools,
    maxSteps = 1,
    abortSignal,
    abortController,
    onStepFinish,
    approvalContext,
    contextWindow,
    compactionStrategy = 'window',
    budgetConfig,
    onBudgetExceeded,
    getDailyCost,
    chatSessionId,
  } = input

  const effectiveAbortSignal = abortController?.signal ?? abortSignal
  let accumulatedTurnCost = 0

  const effectiveTools = approvalContext
    ? wrapToolsWithApproval(tools, approvalContext)
    : tools

  const compactionConfig = resolveCompactionConfig({
    contextWindow,
  })

  const result = streamText({
    model,
    messages,
    system,
    tools: effectiveTools,
    stopWhen: maxSteps > 1 ? stepCountIs(maxSteps) : undefined,
    abortSignal: effectiveAbortSignal,
    experimental_telemetry: langfuseEnabled
      ? {
          isEnabled: true,
          metadata: {
            'langfuse.session.id': chatSessionId ?? '',
            'langfuse.trace.name': 'ai-sdk-chat',
          },
        }
      : undefined,
    onStepFinish: (step) => {
      if (onStepFinish && step.usage) {
        const hasToolCalls = step.toolCalls && step.toolCalls.length > 0
        const inferredStepType = step.stepNumber === 0
          ? 'initial'
          : hasToolCalls
            ? 'tool-result'
            : 'continue'

        onStepFinish({
          stepNumber: step.stepNumber,
          stepType: inferredStepType,
          modelId: step.model?.modelId,
          usage: {
            promptTokens: step.usage.inputTokens ?? 0,
            completionTokens: step.usage.outputTokens ?? 0,
            totalTokens: step.usage.totalTokens ?? (step.usage.inputTokens ?? 0) + (step.usage.outputTokens ?? 0),
          },
        })
      }

      if (budgetConfig && step.usage) {
        const stepCost = estimateCost(step.model?.modelId ?? '', {
          promptTokens: step.usage.inputTokens ?? 0,
          completionTokens: step.usage.outputTokens ?? 0,
        })
        accumulatedTurnCost += stepCost

        const turnCheck = checkTurnBudget(accumulatedTurnCost, budgetConfig.maxCostPerTurn)
        if (!turnCheck.allowed) {
          onBudgetExceeded?.(turnCheck.reason!)
          abortController?.abort(turnCheck.reason)
          return
        }

        if (getDailyCost && budgetConfig.maxCostPerDay) {
          const dailyCost = getDailyCost() + accumulatedTurnCost
          const dailyCheck = checkDailyBudget(dailyCost, budgetConfig.maxCostPerDay)
          if (!dailyCheck.allowed) {
            onBudgetExceeded?.(dailyCheck.reason!)
            abortController?.abort(dailyCheck.reason)
          }
        }
      }
    },
    prepareStep: async ({ steps, messages: currentMessages }) => {
      try {
        if (steps.length === 0) {
          return undefined
        }

        const lastStep = steps.at(-1)
        const usage = lastStep?.usage
        if (!usage) {
          return undefined
        }

        if (isContextOverflow({
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
        }, compactionConfig)) {
          if (currentMessages.length > compactionConfig.keepRecentMessages) {
            if (compactionStrategy === 'summarize') {
              const compacted = await compactWithSummary(currentMessages, model)
              return { messages: compacted }
            }
            return { messages: compactByWindow(currentMessages) }
          }
        }
        return undefined
      }
      catch {
        return undefined
      }
    },
  })

  return { result, effectiveAbortSignal }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return
  }

  throw createAbortError()
}

function createAbortError(): Error {
  const err = new Error('AI SDK turn aborted')
  err.name = 'AbortError'
  return err
}

async function nextOrAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal | undefined): Promise<IteratorResult<T>> {
  if (!signal) {
    return iterator.next()
  }

  throwIfAborted(signal)

  return await new Promise<IteratorResult<T>>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(createAbortError())
    }

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
    }

    signal.addEventListener('abort', onAbort, { once: true })
    iterator.next().then((result) => {
      cleanup()
      resolve(result)
    }, (error) => {
      cleanup()
      reject(error)
    })
  })
}

async function emitUsage(result: ReturnType<typeof streamText>, onUsage?: (usage: TokenUsage) => void): Promise<void> {
  if (!onUsage) {
    return
  }

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

/**
 * Execute an AI SDK agent turn, yielding UIMessageChunk directly.
 *
 * Uses AI SDK's `streamText` + `toUIMessageStream()` to get native
 * UIMessageChunk events — no custom timeline abstraction needed.
 */
export async function* executeAiSdkTurn(input: AiSdkEngineInput): AsyncGenerator<UIMessageChunk, void, void> {
  const { onUsage } = input
  const { result, effectiveAbortSignal } = createAiSdkStreamResult(input)

  // Use toUIMessageStream() to get native UIMessageChunk events
  const uiStream = result.toUIMessageStream()
  const iterator = uiStream[Symbol.asyncIterator]()

  while (true) {
    const { done, value } = await nextOrAbort(iterator, effectiveAbortSignal)
    if (done) {
      break
    }

    yield value
  }

  await emitUsage(result, onUsage)
}

/**
 * Execute an AI SDK turn and emit progressive assistant UIMessage snapshots.
 */
export async function* executeAiSdkTurnSnapshots(input: AiSdkEngineInput & { initialMessage: UIMessage }): AsyncGenerator<UIMessage, void, void> {
  const { initialMessage, onUsage } = input
  const { result, effectiveAbortSignal } = createAiSdkStreamResult(input)

  const messageStream = readUIMessageStream<UIMessage>({
    message: initialMessage,
    stream: result.toUIMessageStream(),
    terminateOnError: true,
  })
  const iterator = messageStream[Symbol.asyncIterator]()

  while (true) {
    const { done, value } = await nextOrAbort(iterator, effectiveAbortSignal)
    if (done) {
      break
    }

    yield value
  }

  await emitUsage(result, onUsage)
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
