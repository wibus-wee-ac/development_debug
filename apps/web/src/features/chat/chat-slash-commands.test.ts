import { describe, expect, it } from 'vitest'

import type { ChatRuntimeCapabilities } from './chat-capabilities'
import type { ChatComposerSlashCommand } from './chat-slash-commands'
import {
  CODEX_REVIEW_SLASH_ACTION_ID,
  CRADLE_APPSHOT_SLASH_ACTION_ID,
  CRADLE_APPSHOT_SLASH_COMMAND,
  createRuntimeSlashCommand,
  createRuntimeUiSlotCommands,
  getFallbackRuntimeSlashCommands,
  hasDuplicateSlashCommandName,
  mergeChatSlashCommands,
  projectRuntimeComposerSlashCommands,
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
      id: 'cradle:appshot',
      name: 'appshot',
      description: 'Capture the frontmost app window',
      argumentHint: '',
      source: 'cradle',
      action: { kind: 'uiAction', actionId: 'capture-appshot' },
    }

    const commands = mergeChatSlashCommands({
      cradleCommands: [cradleCommand],
      runtimeCommands: [
        { name: 'appshot', description: 'Provider appshot command', argumentHint: '' },
      ],
    })

    expect(commands.map(command => command.id)).toEqual(['cradle:appshot', 'runtime:appshot:0'])
    expect(commands.map(command => command.name)).toEqual(['appshot', 'appshot'])
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
      iconKey: 'appshot',
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

  it('projects runtime ui slots into slot-style slash commands before runtime commands', () => {
    const commands = mergeChatSlashCommands({
      runtimeCommands: [
        { name: 'compact', description: 'Native compact', argumentHint: '' },
      ],
      runtimeUiSlotCommands: createRuntimeUiSlotCommands([
        {
          id: 'codex:goal',
          name: 'goal',
          label: 'Goal',
          description: 'Set or show the active objective.',
          argumentHint: '<objective>',
          aliases: ['objective'],
          iconKey: 'goal',
          commandText: '/goal ',
          surfaces: ['slashCommand'],
        },
      ]),
      cradleCommands: [],
    })

    expect(commands[0]).toMatchObject({
      id: 'codex:goal',
      name: 'goal',
      label: 'Goal',
      source: 'runtime',
      presentation: 'slot',
      action: { kind: 'insertText', text: '/goal ' },
    })
    expect(commands.some(command => command.presentation === 'slot')).toBe(true)
  })

  it('projects Codex compact slots as immediate submit commands', () => {
    const [command] = createRuntimeUiSlotCommands([
      {
        id: 'codex:compact',
        name: 'compact',
        label: 'Compact',
        description: 'Compact this conversation context.',
        argumentHint: '[instructions]',
        iconKey: 'compact',
        commandText: '/compact ',
        surfaces: ['slashCommand', 'runtimePanel'],
      },
    ])

    expect(command).toMatchObject({
      id: 'codex:compact',
      name: 'compact',
      source: 'runtime',
      presentation: 'slot',
      action: { kind: 'submitText', text: '/compact', requiresEmptyComposer: true },
    })
  })

  it('projects Codex review as a host UI action and leaves feedback as raw slash text', () => {
    const commands = createRuntimeUiSlotCommands([
      {
        id: 'codex:review',
        name: 'review',
        label: 'Code review',
        description: 'Review unstaged changes or compare with a branch.',
        argumentHint: '[target]',
        aliases: ['code-review'],
        iconKey: 'code-review',
        commandText: '/review ',
        surfaces: ['slashCommand'],
      },
      {
        id: 'codex:feedback',
        name: 'feedback',
        label: 'Feedback',
        description: 'Send feedback about this chat.',
        argumentHint: '',
        iconKey: 'feedback',
        commandText: '/feedback ',
        surfaces: ['slashCommand'],
      },
    ])

    expect(commands).toEqual([
      expect.objectContaining({
        id: 'codex:review',
        action: { kind: 'uiAction', actionId: CODEX_REVIEW_SLASH_ACTION_ID },
      }),
      expect.objectContaining({
        id: 'codex:feedback',
        action: { kind: 'insertText', text: '/feedback ' },
      }),
    ])
    expect(commands[0]?.availability).toBeUndefined()
    expect(commands[1]?.availability).toBeUndefined()
  })

  it('projects draft runtime ui slots as raw composer text commands', () => {
    const commands = createRuntimeUiSlotCommands([
      {
        id: 'codex:compact',
        name: 'compact',
        label: 'Compact',
        description: 'Compact this conversation context.',
        argumentHint: '[instructions]',
        iconKey: 'compact',
        commandText: '/compact ',
        surfaces: ['slashCommand'],
      },
      {
        id: 'codex:review',
        name: 'review',
        label: 'Code review',
        description: 'Review unstaged changes or compare with a branch.',
        argumentHint: '[target]',
        iconKey: 'code-review',
        commandText: '/review ',
        surfaces: ['slashCommand'],
      },
      {
        id: 'codex:goal',
        name: 'goal',
        label: 'Goal',
        description: 'Set or show the active objective.',
        argumentHint: '<objective>',
        iconKey: 'goal',
        commandText: '/goal ',
        surfaces: ['slashCommand', 'composerState'],
      },
    ], [], 'draft')

    expect(commands).toEqual([
      expect.objectContaining({ id: 'codex:compact', action: { kind: 'insertText', text: '/compact ' } }),
      expect.objectContaining({ id: 'codex:review', action: { kind: 'insertText', text: '/review ' } }),
      expect.objectContaining({ id: 'codex:goal', action: { kind: 'insertText', text: '/goal ' } }),
    ])
  })

  it('does not project picker and metadata slots into slash commands', () => {
    const commands = createRuntimeUiSlotCommands([
      {
        id: 'codex:model',
        name: 'model',
        label: 'Model',
        description: 'Switch the active model.',
        argumentHint: '[model]',
        iconKey: 'model',
        commandText: '/model ',
        surfaces: ['toolbarPicker'],
      },
      {
        id: 'codex:reasoning',
        name: 'reasoning',
        label: 'Reasoning mode',
        description: 'Adjust reasoning effort.',
        argumentHint: '[low|medium|high]',
        iconKey: 'reasoning',
        commandText: '/reasoning ',
        surfaces: ['toolbarPicker'],
      },
      {
        id: 'codex:compact',
        name: 'compact',
        label: 'Compact',
        description: 'Compact this conversation context.',
        argumentHint: '[instructions]',
        iconKey: 'compact',
        commandText: '/compact ',
        surfaces: ['slashCommand'],
      },
      {
        id: 'codex:mcp',
        name: 'mcp',
        label: 'MCP',
        description: 'Show MCP server status.',
        argumentHint: '',
        iconKey: 'mcp',
        commandText: '/mcp ',
        surfaces: ['runtimePanel'],
      },
    ])

    expect(commands.map(command => command.id)).toEqual(['codex:compact'])
  })

  it('projects provider-owned slot state onto runtime slot commands', () => {
    const [compactCommand] = createRuntimeUiSlotCommands([
      {
        id: 'codex:compact',
        name: 'compact',
        label: 'Compact',
        description: 'Compact this conversation context.',
        argumentHint: '[instructions]',
        iconKey: 'compact',
        commandText: '/compact ',
        surfaces: ['slashCommand'],
      },
    ], [
      {
        kind: 'compact',
        slotId: 'codex:compact',
        threadId: 'thread-1',
        turnId: null,
        status: 'idle',
        isCompactRelevant: true,
        total: {
          totalTokens: 52,
          inputTokens: 52,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        modelContextWindow: 100,
        autoCompactTokenLimit: null,
        usagePercent: 52,
        autoCompactPercent: null,
        lastCompactedAt: null,
        compactionItemId: null,
        updatedAt: 1,
      },
    ])

    expect(compactCommand).toMatchObject({
      id: 'codex:compact',
      name: 'compact',
      stateLabel: 'Used 52%',
      stateTone: 'neutral',
      stateVisual: {
        kind: 'compactUsage',
        percent: 52,
        status: 'idle',
      },
    })
  })

  it('projects provider-owned lifecycle state onto expanded runtime slot commands', () => {
    const commands = createRuntimeUiSlotCommands([
      {
        id: 'codex:compact',
        name: 'compact',
        label: 'Compact',
        description: 'Compact this conversation context.',
        argumentHint: '[instructions]',
        iconKey: 'compact',
        commandText: '/compact ',
        surfaces: ['slashCommand'],
      },
      {
        id: 'codex:goal',
        name: 'goal',
        label: 'Goal',
        description: 'Set or show the active objective.',
        argumentHint: '<objective>',
        iconKey: 'goal',
        commandText: '/goal ',
        surfaces: ['slashCommand', 'composerState'],
      },
      {
        id: 'codex:model',
        name: 'model',
        label: 'Model',
        description: 'Switch the active model.',
        argumentHint: '[model]',
        iconKey: 'model',
        commandText: '/model ',
        surfaces: ['toolbarPicker'],
      },
      {
        id: 'codex:skills',
        name: 'skills',
        label: 'Skills',
        description: 'Show skills.',
        argumentHint: '',
        iconKey: 'skills',
        commandText: '/skills ',
        surfaces: ['runtimePanel'],
      },
      {
        id: 'codex:review',
        name: 'review',
        label: 'Code review',
        description: 'Review code changes.',
        argumentHint: '',
        iconKey: 'code-review',
        commandText: '/review ',
        surfaces: ['slashCommand'],
      },
      {
        id: 'codex:feedback',
        name: 'feedback',
        label: 'Feedback',
        description: 'Send feedback.',
        argumentHint: '',
        iconKey: 'feedback',
        commandText: '/feedback ',
        surfaces: ['slashCommand'],
      },
    ], [
      {
        kind: 'compact',
        slotId: 'codex:compact',
        threadId: 'thread-1',
        turnId: 'turn-1',
        status: 'running',
        isCompactRelevant: true,
        total: { totalTokens: 100, inputTokens: 100, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
        last: { totalTokens: 100, inputTokens: 100, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
        modelContextWindow: 1_000,
        autoCompactTokenLimit: null,
        usagePercent: 10,
        autoCompactPercent: null,
        lastCompactedAt: null,
        compactionItemId: 'compact-1',
        updatedAt: 1,
      },
      {
        kind: 'goal',
        slotId: 'codex:goal',
        threadId: 'thread-1',
        objective: 'Ship slot surfaces',
        status: 'active',
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 10,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        kind: 'usage',
        slotId: 'codex:usage',
        threadId: 'thread-1',
        usedPercent: 91,
        secondaryUsedPercent: null,
        creditsBalance: null,
        hasCredits: true,
        rateLimitReachedType: null,
        planType: 'pro',
        updatedAt: 1,
      },
      {
        kind: 'skills',
        slotId: 'codex:skills',
        threadId: 'thread-1',
        enabledCount: 4,
        disabledCount: 1,
        errorCount: 0,
        roots: ['/tmp/project'],
        updatedAt: 1,
      },
      {
        kind: 'config',
        slotId: 'codex:config',
        threadId: 'thread-1',
        modelId: 'gpt-5-codex',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        allowedApprovalPolicyCount: 3,
        allowedSandboxModeCount: 2,
        featureRequirementCount: 5,
        webSearchModeCount: 2,
        updatedAt: 1,
      },
    ])

    expect(commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'codex:compact',
        stateLabel: 'Compacting',
        stateTone: 'neutral',
        stateVisual: {
          kind: 'compactUsage',
          percent: 10,
          status: 'running',
        },
      }),
      expect.objectContaining({ id: 'codex:goal', stateLabel: 'Active', stateTone: 'neutral' }),
      expect.objectContaining({ id: 'codex:review', stateLabel: undefined }),
      expect.objectContaining({ id: 'codex:feedback', stateLabel: undefined }),
    ]))
    expect(commands.map(command => command.id)).not.toEqual(expect.arrayContaining(['codex:model', 'codex:skills']))
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

  it('projects draft and session composer commands through the same capability boundary', () => {
    const capabilities: ChatRuntimeCapabilities = {
      runtimeKind: 'codex',
      slashCommands: [
        { name: 'status', description: 'Native status', argumentHint: '' },
      ],
      skills: [],
      uiSlots: [
        {
          id: 'codex:compact',
          name: 'compact',
          label: 'Compact',
          description: 'Compact this conversation context.',
          argumentHint: '[instructions]',
          iconKey: 'compact',
          commandText: '/compact ',
          surfaces: ['slashCommand', 'runtimePanel'],
        },
        {
          id: 'codex:goal',
          name: 'goal',
          label: 'Goal',
          description: 'Set or show the active objective.',
          argumentHint: '<objective>',
          iconKey: 'goal',
          commandText: '/goal ',
          surfaces: ['slashCommand', 'composerState'],
        },
      ],
    }

    const draftCommands = projectRuntimeComposerSlashCommands({
      capabilities,
      mode: 'draft',
    })
    const sessionCommands = projectRuntimeComposerSlashCommands({
      capabilities,
      slotStates: [
        {
          kind: 'goal',
          slotId: 'codex:goal',
          threadId: 'thread-1',
          objective: 'Unify composers',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 5,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      mode: 'session',
      cradleCommands: [CRADLE_APPSHOT_SLASH_COMMAND],
    })

    expect(draftCommands).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'codex:compact', action: { kind: 'insertText', text: '/compact ' } }),
      expect.objectContaining({ id: 'codex:goal', stateLabel: undefined }),
      expect.objectContaining({ id: 'runtime:status:0', description: 'Native status' }),
    ]))
    expect(draftCommands.some(command => command.id === CRADLE_APPSHOT_SLASH_COMMAND.id)).toBe(false)

    expect(sessionCommands).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'codex:compact', action: { kind: 'submitText', text: '/compact', requiresEmptyComposer: true } }),
      expect.objectContaining({ id: 'codex:goal', stateLabel: 'Active' }),
      CRADLE_APPSHOT_SLASH_COMMAND,
      expect.objectContaining({ id: 'runtime:status:0', description: 'Native status' }),
    ]))
    expect(sessionCommands.filter(command => command.name === 'compact')).toHaveLength(1)
  })
})
