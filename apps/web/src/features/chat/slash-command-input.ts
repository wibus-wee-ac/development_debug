/**
 * Output: Shared slash command input parsing and replacement helpers for composer textareas.
 * Input: Textarea values, cursor positions, and UI-facing slash command descriptors.
 * Position: Chat feature owns slash command interaction semantics shared by chat launch surfaces.
 */

import { Fzf } from 'fzf'

import type { ChatComposerSlashCommand } from './chat-slash-commands'
import { getSlashCommandSourceLabel } from './chat-slash-commands'

export const RE_SIMPLE_SLASH_COMMAND = /^[ \t]*\/[^/\s]*$/
export const CHAT_SLASH_COMMAND_LISTBOX_ID = 'chat-slash-command-listbox'
const MAX_SLASH_COMMAND_RESULTS = 24
const LEADING_INLINE_WHITESPACE_RE = /^[ \t]+/

export interface SlashTriggerState {
  start: number
  query: string
  selectedCommand: ChatComposerSlashCommand | null
}

export function isSlashCommandAvailable(command: ChatComposerSlashCommand): boolean {
  return command.availability?.enabled !== false
}

export function getSlashCommandPrefix(command: ChatComposerSlashCommand): string {
  return command.action.kind === 'insertText' ? command.action.text : `/${command.name} `
}

export function getActiveSlashCommand(inputValue: string, selectedCommand: ChatComposerSlashCommand | null, commands: ChatComposerSlashCommand[]): ChatComposerSlashCommand | null {
  const inputWithoutLeadingInlineWhitespace = inputValue.replace(LEADING_INLINE_WHITESPACE_RE, '')
  if (selectedCommand && inputWithoutLeadingInlineWhitespace.startsWith(getSlashCommandPrefix(selectedCommand))) {
    return selectedCommand
  }

  return commands.find(command => inputWithoutLeadingInlineWhitespace.startsWith(getSlashCommandPrefix(command))) ?? null
}

export function replaceSlashTrigger(inputValue: string, cursor: number, start: number, replacement: string): { value: string, cursor: number } {
  const safeStart = start >= 0 ? start : 0
  const before = inputValue.slice(0, safeStart)
  const after = inputValue.slice(cursor)
  return {
    value: `${before}${replacement}${after}`,
    cursor: before.length + replacement.length,
  }
}

export function getVisibleSlashCommands(commands: ChatComposerSlashCommand[], hasUiActionHandler: boolean): ChatComposerSlashCommand[] {
  return commands.filter(command => command.action.kind !== 'uiAction' || hasUiActionHandler)
}

export function formatSlashCommandSearchText(command: ChatComposerSlashCommand): string {
  return [
    command.name,
    command.description,
    command.argumentHint,
    ...(command.aliases ?? []),
    getSlashCommandSourceLabel(command),
  ].join(' ')
}

export function getSlashCommandPanelItems(commands: ChatComposerSlashCommand[], query: string): ChatComposerSlashCommand[] {
  if (!query) {
    return commands.slice(0, MAX_SLASH_COMMAND_RESULTS)
  }
  return new Fzf(commands, {
    selector: formatSlashCommandSearchText,
    limit: MAX_SLASH_COMMAND_RESULTS,
  }).find(query).map(result => result.item)
}

export function readSlashTriggerState(inputValue: string, cursor: number, commands: ChatComposerSlashCommand[], selectedCommand: ChatComposerSlashCommand | null): SlashTriggerState | null {
  const textBefore = inputValue.slice(0, cursor)
  if (!commands.length || !RE_SIMPLE_SLASH_COMMAND.test(textBefore)) {
    return null
  }

  const start = textBefore.lastIndexOf('/')
  return {
    start,
    query: textBefore.slice(start + 1),
    selectedCommand: getActiveSlashCommand(inputValue, selectedCommand, commands),
  }
}
