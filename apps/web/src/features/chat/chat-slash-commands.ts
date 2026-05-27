/**
 * Output: UI-facing slash command descriptors and merge helpers for the chat composer.
 * Input: Runtime-native slash commands from chat capabilities plus Cradle-owned UI commands.
 * Position: Chat feature owns slash command presentation; runtimes own only raw command capabilities.
 */

import type { RuntimeKind } from '~/lib/types'

import type { ChatSlashCommand } from './chat-capabilities'

export type ChatSlashCommandSource = 'runtime' | 'cradle'

export type ChatSlashCommandAction
  = | { kind: 'insertText', text: string }
    | { kind: 'uiAction', actionId: string }

export interface ChatComposerSlashCommand {
  id: string
  name: string
  description: string
  argumentHint: string
  aliases?: string[]
  source: ChatSlashCommandSource
  action: ChatSlashCommandAction
  availability?: {
    enabled: boolean
    reason: string
  }
}

export const CRADLE_APPSHOT_SLASH_ACTION_ID = 'capture-appshot'

export const CRADLE_APPSHOT_SLASH_COMMAND: ChatComposerSlashCommand = {
  id: 'cradle:appshot',
  name: 'appshot',
  description: 'Capture the frontmost app window',
  argumentHint: '',
  source: 'cradle',
  action: { kind: 'uiAction', actionId: CRADLE_APPSHOT_SLASH_ACTION_ID },
}

export const CRADLE_FALLBACK_RUNTIME_SLASH_COMMANDS: ChatComposerSlashCommand[] = [
  {
    id: 'fallback-runtime:compact',
    name: 'compact',
    description: 'Compact the conversation context',
    argumentHint: '[instructions]',
    aliases: ['summarize'],
    source: 'runtime',
    action: { kind: 'insertText', text: '/compact ' },
  },
  {
    id: 'fallback-runtime:init',
    name: 'init',
    description: 'Create or refresh project instructions',
    argumentHint: '',
    source: 'runtime',
    action: { kind: 'insertText', text: '/init ' },
  },
  {
    id: 'fallback-runtime:review',
    name: 'review',
    description: 'Review code changes or a target file',
    argumentHint: '[target]',
    aliases: ['code-review'],
    source: 'runtime',
    action: { kind: 'insertText', text: '/review ' },
  },
  {
    id: 'fallback-runtime:status',
    name: 'status',
    description: 'Show current task or session status',
    argumentHint: '',
    source: 'runtime',
    action: { kind: 'insertText', text: '/status ' },
  },
  {
    id: 'fallback-runtime:help',
    name: 'help',
    description: 'Show available runtime commands',
    argumentHint: '[command]',
    aliases: ['?'],
    source: 'runtime',
    action: { kind: 'insertText', text: '/help ' },
  },
]

export interface MergeChatSlashCommandsInput {
  runtimeCommands: ChatSlashCommand[]
  cradleCommands: ChatComposerSlashCommand[]
  fallbackRuntimeCommands?: ChatComposerSlashCommand[]
}

function normalizeCommandName(name: string): string {
  return name.trim().replace(/^\/+/, '')
}

export function createRuntimeSlashCommand(command: ChatSlashCommand, index = 0): ChatComposerSlashCommand {
  const name = normalizeCommandName(command.name)
  return {
    id: `runtime:${name}:${index}`,
    name,
    description: command.description,
    argumentHint: command.argumentHint,
    aliases: command.aliases,
    source: 'runtime',
    action: { kind: 'insertText', text: `/${name} ` },
  }
}

export function mergeChatSlashCommands({
  runtimeCommands,
  cradleCommands,
  fallbackRuntimeCommands = [],
}: MergeChatSlashCommandsInput): ChatComposerSlashCommand[] {
  const runtimeCommandNames = new Set(runtimeCommands.map(command => normalizeCommandName(command.name).toLowerCase()))
  const fallbackCommands = fallbackRuntimeCommands.filter(command => !runtimeCommandNames.has(command.name.toLowerCase()))
  const enabledCradleCommands = cradleCommands.filter(command => command.availability?.enabled !== false)
  const disabledCradleCommands = cradleCommands.filter(command => command.availability?.enabled === false)
  return [
    ...enabledCradleCommands,
    ...fallbackCommands,
    ...runtimeCommands.map(createRuntimeSlashCommand),
    ...disabledCradleCommands,
  ]
}

export function getFallbackRuntimeSlashCommands(runtimeKind: RuntimeKind | string | null | undefined): ChatComposerSlashCommand[] {
  if (runtimeKind === 'cli-tui') {
    return []
  }
  return CRADLE_FALLBACK_RUNTIME_SLASH_COMMANDS
}

export function withSlashCommandAvailability(
  command: ChatComposerSlashCommand,
  availability: ChatComposerSlashCommand['availability'],
): ChatComposerSlashCommand {
  return { ...command, availability }
}

export function hasDuplicateSlashCommandName(commands: ChatComposerSlashCommand[], command: ChatComposerSlashCommand): boolean {
  const name = command.name.toLowerCase()
  return commands.some(candidate => candidate !== command && candidate.name.toLowerCase() === name)
}

export function getSlashCommandSourceLabel(command: ChatComposerSlashCommand): string {
  return command.source === 'runtime' ? 'Runtime' : 'Cradle'
}
