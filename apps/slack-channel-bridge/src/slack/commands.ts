import type { BridgeStore } from '../store'
import type { CradleService, ProviderModelSummary, SessionSummary, SessionTargetSummary } from '../cradle/service'
import type { SlackBlockMessage } from './format'
import {
  CRADLE_SESSION_MODEL_SELECT_ACTION,
  CRADLE_SESSION_TARGET_SELECT_ACTION,
  buildSessionTargetSelectBlocks,
  describeSessionModel,
  describeSessionTarget,
  parseSessionModelValue,
  parseSessionTargetValue,
  selectedTargetForBinding,
} from './session-targets'

export interface CradleCommand {
  team_id?: string
  channel_id: string
  user_id: string
  text: string
}

export type SlackResponder = (message: {
  text: string
  blocks?: SlackBlockMessage['blocks']
  response_type?: 'ephemeral' | 'in_channel'
  replace_original?: boolean
}) => Promise<unknown>

export interface CommandDependencies {
  store: BridgeStore
  cradle: Pick<CradleService, 'verifyWorkspace' | 'getSessionSummary' | 'listSessionTargets' | 'listProviderTargetModels'>
}

export interface CradleActionContext {
  team?: {
    id?: string
  } | null
  channel?: {
    id?: string
  } | null
  user?: {
    id?: string
  } | null
  actions?: Array<{
    action_id?: string
    selected_option?: {
      value?: string
    } | null
    value?: string
  }>
}

export const CRADLE_STATUS_REFRESH_ACTION = 'cradle_status_refresh'
export const CRADLE_CHANNEL_UNBIND_ACTION = 'cradle_channel_unbind'
export { CRADLE_SESSION_MODEL_SELECT_ACTION, CRADLE_SESSION_TARGET_SELECT_ACTION }

interface StatusConversation {
  threadTs: string
  cradleSessionId: string
  sessionTitle: string | null
}

function parseCommand(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

function escapeSlackText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function slackDateFromThreadTs(threadTs: string): string {
  const seconds = Number(threadTs.split('.')[0])
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 'an earlier Slack conversation'
  }
  const fallback = new Date(seconds * 1000).toLocaleString('en-US')
  return `<!date^${seconds}^{date_short_pretty} at {time}|${fallback}>`
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id
}

function buildStatusMessage(input: {
  channelId: string
  binding: Awaited<ReturnType<BridgeStore['getWorkspaceBinding']>>
  conversations: StatusConversation[]
  sessionTargets: SessionTargetSummary[]
  models: ProviderModelSummary[]
}): {
  text: string
  blocks: SlackBlockMessage['blocks']
} {
  const bindingText = input.binding
    ? `This Slack channel is connected to Cradle workspace ${input.binding.cradleWorkspaceId}.`
    : 'This Slack channel is not connected to a Cradle workspace.'
  const threadText = input.conversations.length
    ? input.conversations.map(conversation => `- ${conversation.sessionTitle ?? 'Untitled Cradle session'} started from a Slack conversation on ${slackDateFromThreadTs(conversation.threadTs)}.`).join('\n')
    : 'No Slack conversations have been connected to Cradle yet.'
  const sessionTargetText = describeSessionTarget(input.binding, input.sessionTargets)
  const sessionModelText = describeSessionModel(input.binding, input.models)
  const blocks: SlackBlockMessage['blocks'] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Cradle Slack Bridge',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: input.binding
          ? `*Connected.* New Slack threads in this channel can create Cradle sessions in *${escapeSlackText(input.binding.cradleWorkspaceId)}*. Replies in already-connected threads continue the matching Cradle session.`
          : '*Not connected yet.* Bind this channel to a Cradle workspace before starting new Slack-backed Cradle sessions.',
      },
    },
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: input.binding
          ? `Workspace: \`${escapeSlackText(input.binding.cradleWorkspaceId)}\` | Runtime: ${sessionTargetText} | Model: ${sessionModelText}`
          : 'Run `/cradle bind workspace <workspace-id>` to connect this channel.',
      }],
    },
    {
      type: 'divider',
    },
  ]

  if (input.conversations.length) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Recent connected conversations*',
      },
    })
    for (const conversation of input.conversations) {
      const title = conversation.sessionTitle?.trim() || 'Untitled Cradle session'
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${escapeSlackText(title)}*\nStarted from a Slack conversation on ${slackDateFromThreadTs(conversation.threadTs)}.`,
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View details',
          },
          action_id: CRADLE_STATUS_REFRESH_ACTION,
          value: conversation.cradleSessionId,
        },
      })
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `Slack thread \`${escapeSlackText(conversation.threadTs)}\` · Cradle session \`${escapeSlackText(shortId(conversation.cradleSessionId))}\``,
        }],
      })
    }
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'No Slack conversations have been connected to Cradle yet. Mention the bot in this channel to start the first one after the channel is bound.',
      },
    })
  }

  if (input.binding) {
    blocks.push({
      type: 'divider',
    })
    blocks.push(...buildSessionTargetSelectBlocks({
      binding: input.binding,
      targets: input.sessionTargets,
      models: input.models,
      prompt: '*Default runtime for new Slack threads*',
    }))
  }

  blocks.push(
    {
      type: 'divider',
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Refresh status',
          },
          action_id: CRADLE_STATUS_REFRESH_ACTION,
          value: input.channelId,
        },
        ...(input.binding
          ? [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Disconnect channel',
                },
                action_id: CRADLE_CHANNEL_UNBIND_ACTION,
                style: 'danger',
                value: input.channelId,
                confirm: {
                  title: {
                    type: 'plain_text',
                    text: 'Disconnect channel?',
                  },
                  text: {
                    type: 'mrkdwn',
                    text: 'New Slack threads in this channel will stop creating Cradle sessions until the channel is connected again.',
                  },
                  confirm: {
                    type: 'plain_text',
                    text: 'Disconnect',
                  },
                  deny: {
                    type: 'plain_text',
                    text: 'Cancel',
                  },
                },
              } as const,
            ]
          : []),
      ],
    },
  )

  return {
    text: `${bindingText}\nDefault runtime: ${sessionTargetText}\nDefault model: ${sessionModelText}\n\nRecent connected conversations:\n${threadText}`,
    blocks,
  }
}

async function listModelsForBinding(input: {
  binding: Awaited<ReturnType<BridgeStore['getWorkspaceBinding']>>
  targets: SessionTargetSummary[]
  deps: CommandDependencies
}): Promise<ProviderModelSummary[]> {
  const selected = selectedTargetForBinding(input.binding, input.targets)
  if (!selected?.providerTargetId) {
    return []
  }
  try {
    return await input.deps.cradle.listProviderTargetModels(selected.providerTargetId)
  } catch (error) {
    console.warn('[slack-channel-bridge] failed to list provider target models', error)
    return []
  }
}

async function resolveStatusConversations(input: {
  deps: CommandDependencies
  threads: Awaited<ReturnType<BridgeStore['listRecentThreadBindings']>>
}): Promise<StatusConversation[]> {
  const sessions = await Promise.all(input.threads.map(async (thread): Promise<SessionSummary | null> => {
    try {
      return await input.deps.cradle.getSessionSummary(thread.cradleSessionId)
    } catch {
      return null
    }
  }))
  return input.threads.map((thread, index) => ({
    threadTs: thread.threadTs,
    cradleSessionId: thread.cradleSessionId,
    sessionTitle: sessions[index]?.title ?? null,
  }))
}

async function respondWithStatus(input: {
  teamId: string
  channelId: string
  respond: SlackResponder
  deps: CommandDependencies
  replaceOriginal?: boolean
}): Promise<void> {
  const binding = await input.deps.store.getWorkspaceBinding(input.teamId, input.channelId)
  const threads = await input.deps.store.listRecentThreadBindings(input.teamId, input.channelId, 5)
  const [conversations, sessionTargets] = await Promise.all([
    resolveStatusConversations({ deps: input.deps, threads }),
    input.deps.cradle.listSessionTargets(),
  ])
  const models = await listModelsForBinding({ binding, targets: sessionTargets, deps: input.deps })
  const message = buildStatusMessage({ channelId: input.channelId, binding, conversations, sessionTargets, models })
  await input.respond({
    text: message.text,
    blocks: message.blocks,
    response_type: 'ephemeral',
    replace_original: input.replaceOriginal,
  })
}

export async function handleCradleCommand(
  command: CradleCommand,
  respond: SlackResponder,
  deps: CommandDependencies,
): Promise<void> {
  const teamId = command.team_id
  if (!teamId) {
    await respond({ text: 'Slack team id was missing from this command.', response_type: 'ephemeral' })
    return
  }

  const [action, subject, value] = parseCommand(command.text)

  if (action === 'bind' && subject === 'workspace' && value) {
    const exists = await deps.cradle.verifyWorkspace(value)
    if (!exists) {
      await respond({ text: `Workspace ${value} was not found in Cradle.`, response_type: 'ephemeral' })
      return
    }
    await deps.store.setWorkspaceBinding({
      teamId,
      channelId: command.channel_id,
      cradleWorkspaceId: value,
      boundBySlackUserId: command.user_id,
    })
    const binding = await deps.store.getWorkspaceBinding(teamId, command.channel_id)
    const sessionTargets = await deps.cradle.listSessionTargets()
    const models = await listModelsForBinding({ binding, targets: sessionTargets, deps })
    await respond({
      text: `Bound this Slack channel to Cradle workspace ${value}. Choose the default Cradle runtime for new Slack threads.`,
      blocks: buildSessionTargetSelectBlocks({
        binding,
        targets: sessionTargets,
        models,
        prompt: `Bound this Slack channel to Cradle workspace \`${escapeSlackText(value)}\`. Choose the default Cradle runtime for new Slack threads.`,
      }),
      response_type: 'in_channel',
    })
    return
  }

  if (action === 'unbind') {
    await deps.store.removeWorkspaceBinding(teamId, command.channel_id)
    await respond({ text: 'Removed the Cradle workspace binding for this channel.', response_type: 'in_channel' })
    return
  }

  if (action === 'status' || !action) {
    await respondWithStatus({
      teamId,
      channelId: command.channel_id,
      respond,
      deps,
    })
    return
  }

  await respond({
    text: 'Usage: /cradle bind workspace <workspace-id>, /cradle unbind, or /cradle status',
    response_type: 'ephemeral',
  })
}

export async function handleCradleStatusRefreshAction(
  action: CradleActionContext,
  respond: SlackResponder,
  deps: CommandDependencies,
): Promise<void> {
  const teamId = action.team?.id
  const channelId = action.channel?.id
  if (!teamId || !channelId) {
    await respond({ text: 'Slack action context was missing team or channel id.', response_type: 'ephemeral' })
    return
  }
  await respondWithStatus({
    teamId,
    channelId,
    respond,
    deps,
    replaceOriginal: true,
  })
}

export async function handleCradleChannelUnbindAction(
  action: CradleActionContext,
  respond: SlackResponder,
  deps: CommandDependencies,
): Promise<void> {
  const teamId = action.team?.id
  const channelId = action.channel?.id
  if (!teamId || !channelId) {
    await respond({ text: 'Slack action context was missing team or channel id.', response_type: 'ephemeral' })
    return
  }
  await deps.store.removeWorkspaceBinding(teamId, channelId)
  await respondWithStatus({
    teamId,
    channelId,
    respond,
    deps,
    replaceOriginal: true,
  })
}

export async function handleCradleSessionTargetSelectAction(
  action: CradleActionContext,
  respond: SlackResponder,
  deps: CommandDependencies,
): Promise<void> {
  const teamId = action.team?.id
  const channelId = action.channel?.id
  const selectedValue = action.actions?.find(item => item.action_id === CRADLE_SESSION_TARGET_SELECT_ACTION)
    ?.selected_option?.value
  if (!teamId || !channelId) {
    await respond({ text: 'Slack action context was missing team or channel id.', response_type: 'ephemeral' })
    return
  }
  const parsed = selectedValue ? parseSessionTargetValue(selectedValue) : null
  if (!parsed) {
    await respond({ text: 'Selected Cradle runtime was invalid.', response_type: 'ephemeral' })
    return
  }
  const binding = await deps.store.getWorkspaceBinding(teamId, channelId)
  if (!binding) {
    await respond({ text: 'Bind this channel to a Cradle workspace before choosing a runtime.', response_type: 'ephemeral' })
    return
  }
  const sessionTargets = await deps.cradle.listSessionTargets()
  const target = sessionTargets.find(candidate => candidate.kind === parsed.kind && candidate.id === parsed.id)
  if (!target) {
    await respond({ text: 'Selected Cradle runtime is no longer available.', response_type: 'ephemeral' })
    return
  }
  await deps.store.setWorkspaceSessionTemplate({
    teamId,
    channelId,
    sessionAgentId: target.kind === 'agent' ? target.id : null,
    sessionProviderTargetId: target.kind === 'provider-target' ? target.id : null,
    sessionRuntimeKind: target.kind === 'provider-target' ? target.runtimeKind : null,
    sessionModelId: null,
  })
  await respondWithStatus({
    teamId,
    channelId,
    respond,
    deps,
    replaceOriginal: true,
  })
}

export async function handleCradleSessionModelSelectAction(
  action: CradleActionContext,
  respond: SlackResponder,
  deps: CommandDependencies,
): Promise<void> {
  const teamId = action.team?.id
  const channelId = action.channel?.id
  const selectedValue = action.actions?.find(item => item.action_id === CRADLE_SESSION_MODEL_SELECT_ACTION)
    ?.selected_option?.value
  if (!teamId || !channelId) {
    await respond({ text: 'Slack action context was missing team or channel id.', response_type: 'ephemeral' })
    return
  }
  if (!selectedValue) {
    await respond({ text: 'Selected Cradle model was invalid.', response_type: 'ephemeral' })
    return
  }
  const binding = await deps.store.getWorkspaceBinding(teamId, channelId)
  if (!binding) {
    await respond({ text: 'Bind this channel to a Cradle workspace before choosing a model.', response_type: 'ephemeral' })
    return
  }
  const sessionTargets = await deps.cradle.listSessionTargets()
  const selectedTarget = selectedTargetForBinding(binding, sessionTargets)
  if (!selectedTarget?.providerTargetId) {
    await respond({ text: 'Choose a Cradle runtime before choosing a model.', response_type: 'ephemeral' })
    return
  }
  const modelId = parseSessionModelValue(selectedValue)
  if (modelId) {
    const models = await deps.cradle.listProviderTargetModels(selectedTarget.providerTargetId)
    if (!models.some(model => model.id === modelId)) {
      await respond({ text: 'Selected Cradle model is no longer available.', response_type: 'ephemeral' })
      return
    }
  }
  await deps.store.setWorkspaceSessionModel({
    teamId,
    channelId,
    sessionModelId: modelId,
  })
  await respondWithStatus({
    teamId,
    channelId,
    respond,
    deps,
    replaceOriginal: true,
  })
}
