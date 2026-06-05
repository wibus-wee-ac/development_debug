/**
 * Output: Claude Agent runtime identity, static capabilities, and presentation projection.
 * Input: Claude Agent SDK slash command metadata.
 * Position: Claude Agent provider package metadata owner.
 */

import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk'

import type {
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
  RuntimePresentationCapabilities,
  RuntimeSlashCommand,
} from '../../chat-runtime/runtime-provider-types'
import type { RuntimeKind } from '../../provider-contracts/types'

export const CLAUDE_AGENT_RUNTIME_KIND: RuntimeKind = 'claude-agent'

export const CLAUDE_AGENT_RUNTIME_METADATA = {
  label: 'Claude Agent',
  description: 'Claude Agent SDK runtime',
  providerKinds: ['anthropic', 'universal'],
  iconKey: 'claude-agent',
  surfaces: ['chat', 'jarvis'],
  sortOrder: 30,
} satisfies ChatRuntimeMetadata

export const CLAUDE_AGENT_RUNTIME_CAPABILITIES = {
  supportsSteerTurn: true,
  supportsShellExecution: false,
  supportsPermissionMode: true,
  supportsUiSlotStates: false,
  supportsDynamicCapabilities: false,
  sessionModelSwitch: 'restart-session',
} satisfies ChatRuntimeCapabilities

export function projectClaudeAgentPresentation(slashCommands: SlashCommand[]): RuntimePresentationCapabilities {
  return {
    runtimeKind: CLAUDE_AGENT_RUNTIME_KIND,
    slashCommands: slashCommands.map(toRuntimeSlashCommand),
    uiSlots: [],
    skills: [],
  }
}

function toRuntimeSlashCommand(command: SlashCommand): RuntimeSlashCommand {
  return {
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint,
    aliases: command.aliases,
  }
}
