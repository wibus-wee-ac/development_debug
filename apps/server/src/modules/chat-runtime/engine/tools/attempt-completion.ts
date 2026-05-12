// AttemptCompletion — special tool that signals agentic loop termination
// Position: apps/server/src/modules/chat-runtime/engine/tools/attempt-completion.ts

import { tool } from 'ai'
import { z } from 'zod'

/**
 * AttemptCompletion is a special tool that the model calls to signal
 * "I have completed the task, here is my final answer."
 *
 * When used with AI SDK's `stopWhen: [hasTool('attempt_completion')]`,
 * the agentic loop terminates upon this tool being called.
 *
 * Usage:
 * ```ts
 * const tools = { ...userTools, attempt_completion: attemptCompletionTool }
 * streamText({ ..., tools, stopWhen: [hasTool('attempt_completion')] })
 * ```
 */
export const attemptCompletionTool = tool({
  description: 'Call this tool when you have completed the task. Provide your final answer/result in the "result" parameter. This signals the end of your work.',
  inputSchema: z.object({
    result: z.string().describe('Your final answer or summary of completed work'),
    command: z.string().optional().describe('Optional shell command to demonstrate the result'),
  }),
  execute: async ({ result }) => {
    // The tool itself doesn't need to do anything —
    // AI SDK's stopWhen detects its invocation and terminates the loop.
    return result
  },
})
