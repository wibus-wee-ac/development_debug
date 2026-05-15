// Input: AI SDK ToolSet + approval service context
// Output: Wrapped ToolSet with approval gates
// Position: apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts

import type { Tool, ToolSet } from 'ai'

import * as ApprovalService from '../../approval/service'

const SAFE_TOOLS = new Set<string>([
  // Read-only file/search operations
  'read_file',
  'list_files',
  'search_files',
  'list_dir',
  'file_search',
  'grep_search',
  'find_files',
  'get_file_info',
  'search_code',
  'read_directory',
  // Completion signal (no side effects)
  'attempt_completion',
])

function truncateForDisplay(input: unknown): string {
  const s = JSON.stringify(input)
  return s.length > 500 ? `${s.slice(0, 500)}... [truncated]` : s
}

export interface ToolApprovalContext {
  chatSessionId: string
  runtimeKind: string
}

export function wrapToolsWithApproval(
  tools: ToolSet | undefined,
  ctx: ToolApprovalContext,
): ToolSet | undefined {
  if (!tools) {
    return undefined
  }

  const wrapped: ToolSet = {}
  for (const [name, originalTool] of Object.entries(tools)) {
    if (SAFE_TOOLS.has(name)) {
      wrapped[name] = originalTool
      continue
    }
    wrapped[name] = wrapSingleTool(name, originalTool as Tool, ctx)
  }
  return wrapped
}

function wrapSingleTool(name: string, original: Tool, ctx: ToolApprovalContext): Tool {
  return {
    ...original,
    execute: original.execute
      ? async (input: unknown, options: unknown) => {
          const policyKeys = ApprovalService.generatePolicyKeys({
            runtimeKind: ctx.runtimeKind,
            chatSessionId: ctx.chatSessionId,
            toolName: name,
          })

          // Auto-approve if previously allowed
          if (ApprovalService.isPreviouslyAllowed(ctx.chatSessionId, policyKeys)) {
            return (original.execute as (...args: unknown[]) => unknown)(input, options)
          }

          // Request approval (blocks until user responds)
          const response = await ApprovalService.requestApproval({
            chatSessionId: ctx.chatSessionId,
            agentId: ctx.runtimeKind,
            prompt: `Allow tool "${name}"?\nInput: ${truncateForDisplay(input)}`,
            options: [
              { optionId: 'allow_once', label: 'Allow Once' },
              { optionId: 'allow_always', label: 'Always Allow' },
              { optionId: 'deny', label: 'Deny' },
            ],
          })

          if (response.decision === 'rejected') {
            throw new Error(`Tool "${name}" was denied by user`)
          }

          if (response.selectedOptionId === 'allow_always') {
            ApprovalService.markAllowed(ctx.chatSessionId, policyKeys)
          }

          return (original.execute as (...args: unknown[]) => unknown)(input, options)
        }
      : undefined,
  } as Tool
}
