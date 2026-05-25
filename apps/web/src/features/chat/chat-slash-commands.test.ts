/**
 * Output: Regression coverage for chat slash command descriptor merging.
 * Input: Runtime-native command capabilities and Cradle-owned UI command descriptors.
 * Position: Chat feature tests for composer slash command ownership boundaries.
 */

import { describe, expect, it } from 'vitest'

import type { ChatComposerSlashCommand } from './chat-slash-commands'
import {
  CRADLE_APPSHOT_SLASH_ACTION_ID,
  CRADLE_APPSHOT_SLASH_COMMAND,
  createRuntimeSlashCommand,
  getFallbackRuntimeSlashCommands,
  hasDuplicateSlashCommandName,
  mergeChatSlashCommands,
  withSlashCommandAvailability,
} from './chat-slash-commands'

describe('chat slash commands', () => {
  it('converts runtime commands into raw insert-text descriptors', () => {
    expect(createRuntimeSlashCommand({
      name: '/compact',
      description: 'Compact the conversation',
      argumentHint: '[instructions]',
      aliases: ['summarize'],
    })).toEqual({
      id: 'runtime:compact:0',
      name: 'compact',
      description: 'Compact the conversation',
      argumentHint: '[instructions]',
      aliases: ['summarize'],
      source: 'runtime',
      action: { kind: 'insertText', text: '/compact ' },
    })
  })

  it('keeps Cradle commands and runtime commands visible when names overlap', () => {
    const cradleCommand: ChatComposerSlashCommand = {
      id: 'cradle:goal',
      name: 'goal',
      description: 'Open Cradle goal editor',
      argumentHint: '',
      source: 'cradle',
      action: { kind: 'uiAction', actionId: 'open-goal-editor' },
    }

    const commands = mergeChatSlashCommands({
      cradleCommands: [cradleCommand],
      runtimeCommands: [
        { name: 'goal', description: 'Provider goal command', argumentHint: '<objective>' },
      ],
    })

    expect(commands.map(command => command.id)).toEqual(['cradle:goal', 'runtime:goal:0'])
    expect(commands.map(command => command.name)).toEqual(['goal', 'goal'])
    expect(hasDuplicateSlashCommandName(commands, commands[0]!)).toBe(true)
    expect(hasDuplicateSlashCommandName(commands, commands[1]!)).toBe(true)
  })

  it('defines Appshot as a Cradle-owned UI slash command', () => {
    expect(CRADLE_APPSHOT_SLASH_COMMAND).toEqual({
      id: 'cradle:appshot',
      name: 'appshot',
      description: 'Capture the frontmost app window',
      argumentHint: '',
      source: 'cradle',
      action: { kind: 'uiAction', actionId: CRADLE_APPSHOT_SLASH_ACTION_ID },
    })
  })

  it('does not mutate input command arrays', () => {
    const runtimeCommands = [{ name: 'compact', description: 'Compact', argumentHint: '' }]
    const cradleCommands: ChatComposerSlashCommand[] = []

    const merged = mergeChatSlashCommands({ runtimeCommands, cradleCommands })

    expect(runtimeCommands).toEqual([{ name: 'compact', description: 'Compact', argumentHint: '' }])
    expect(cradleCommands).toEqual([])
    expect(merged).not.toBe(runtimeCommands)
    expect(merged).not.toBe(cradleCommands)
  })

  it('uses fallback runtime commands until native runtime capabilities replace matching names', () => {
    const commands = mergeChatSlashCommands({
      cradleCommands: [],
      fallbackRuntimeCommands: getFallbackRuntimeSlashCommands('codex'),
      runtimeCommands: [
        { name: 'compact', description: 'Native compact', argumentHint: '' },
      ],
    })

    expect(commands.find(command => command.name === 'compact')?.description).toBe('Native compact')
    expect(commands.some(command => command.name === 'init')).toBe(true)
    expect(commands.filter(command => command.name === 'compact')).toHaveLength(1)
  })

  it('keeps disabled Cradle UI commands visible after selectable text commands', () => {
    const disabledAppshot = withSlashCommandAvailability(CRADLE_APPSHOT_SLASH_COMMAND, {
      enabled: false,
      reason: 'Requires the macOS desktop app.',
    })

    const commands = mergeChatSlashCommands({
      cradleCommands: [disabledAppshot],
      fallbackRuntimeCommands: getFallbackRuntimeSlashCommands('codex'),
      runtimeCommands: [],
    })

    expect(commands[0]?.name).toBe('compact')
    expect(commands.at(-1)).toEqual(disabledAppshot)
  })
})
