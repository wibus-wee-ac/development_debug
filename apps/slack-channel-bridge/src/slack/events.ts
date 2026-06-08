import type { BridgeStore } from '../store'
import type { CradleService, CradleSessionDefaults, SendMessageResult } from '../cradle/service'
import type { DeliveryAttempt, ThreadBinding, WorkspaceBinding } from '../db/schema'
import {
  buildSlackProvenanceText,
  renderMarkdownForSlack,
  type SlackBlockMessage,
  stripBotMention,
  titleFromSlackText,
} from './format'
import { buildSessionTargetSelectBlocks } from './session-targets'

export interface SlackMessageEvent {
  type?: string
  subtype?: string
  channel?: string
  user?: string
  text?: string
  ts?: string
  thread_ts?: string
  bot_id?: string
}

export interface SlackEventEnvelope {
  event_id?: string
  team_id?: string
  event: SlackMessageEvent
}

export interface SlackPoster {
  postMessage(input: {
    channel: string
    threadTs: string
    text: string
    blocks?: SlackBlockMessage['blocks']
  }): Promise<{ ts: string }>
  addReaction(input: {
    channel: string
    ts: string
    name: string
  }): Promise<void>
}

export interface EventDependencies {
  store: BridgeStore
  cradle: Pick<CradleService, 'createSlackBackedSession' | 'sendMessageAndCollectResponse' | 'listSessionTargets'>
  poster: SlackPoster
  botUserId?: string | null
}

function isIgnorableMessage(event: SlackMessageEvent): boolean {
  return Boolean(event.bot_id || event.subtype === 'bot_message' || event.subtype === 'message_changed' || event.subtype === 'message_deleted')
}

function eventIdFor(envelope: SlackEventEnvelope, teamId: string, event: SlackMessageEvent): string {
  return envelope.event_id ?? `${teamId}:${event.channel ?? 'unknown'}:${event.ts ?? 'unknown'}:${event.subtype ?? 'message'}`
}

function shouldProcessMessage(event: SlackMessageEvent, hasThreadBinding: boolean, botUserId?: string | null): boolean {
  if (hasThreadBinding) {
    return true
  }
  if (!event.text) {
    return false
  }
  return botUserId ? event.text.includes(`<@${botUserId}>`) : event.type === 'app_mention'
}

async function deliverResponse(input: {
  store: BridgeStore
  poster: SlackPoster
  binding: ThreadBinding
  response: SendMessageResult
}): Promise<void> {
  const messages = renderMarkdownForSlack(input.response.text)
  for (const message of messages) {
    const attempt = await input.store.createDeliveryAttempt({
      teamId: input.binding.teamId,
      channelId: input.binding.channelId,
      threadTs: input.binding.threadTs,
      cradleSessionId: input.binding.cradleSessionId,
      cradleMessageId: input.response.assistantMessageId,
      runId: input.response.runId,
      messageText: message.text,
      messageBlocksJson: JSON.stringify(message.blocks),
    })
    try {
      const posted = await input.poster.postMessage({
        channel: input.binding.channelId,
        threadTs: input.binding.threadTs,
        text: message.text,
        blocks: message.blocks,
      })
      await input.store.markDeliveryAttemptDelivered(attempt.id, posted.ts)
    } catch (error) {
      await input.store.markDeliveryAttemptFailed(attempt.id, error instanceof Error ? error.message : String(error))
      throw error
    }
  }
}

function blocksFromAttempt(attempt: DeliveryAttempt): SlackBlockMessage['blocks'] | undefined {
  if (!attempt.messageBlocksJson) {
    return undefined
  }
  try {
    const blocks = JSON.parse(attempt.messageBlocksJson) as unknown
    return Array.isArray(blocks) ? blocks as SlackBlockMessage['blocks'] : undefined
  } catch {
    return undefined
  }
}

function sessionDefaultsFromBinding(binding: WorkspaceBinding): CradleSessionDefaults | null {
  if (binding.sessionAgentId) {
    return {
      agentId: binding.sessionAgentId,
      modelId: binding.sessionModelId,
    }
  }
  if (binding.sessionProviderTargetId) {
    return {
      providerTargetId: binding.sessionProviderTargetId,
      runtimeKind: binding.sessionRuntimeKind ?? 'standard',
      modelId: binding.sessionModelId,
    }
  }
  return null
}

export async function handleSlackMessageEvent(
  envelope: SlackEventEnvelope,
  deps: EventDependencies,
): Promise<void> {
  const event = envelope.event
  const teamId = envelope.team_id
  const channelId = event.channel
  const slackTs = event.ts
  const threadTs = event.thread_ts ?? event.ts

  if (!teamId || !channelId || !slackTs || !threadTs) {
    return
  }

  const id = eventIdFor(envelope, teamId, event)
  const created = await deps.store.recordInboundEvent({
    eventId: id,
    teamId,
    channelId,
    threadTs,
    slackTs,
    eventType: event.type ?? 'message',
  })
  if (created === 'duplicate') {
    return
  }

  try {
    if (isIgnorableMessage(event)) {
      await deps.store.markInboundEventIgnored(id, 'ignored Slack message subtype')
      return
    }

    const existingBinding = await deps.store.getThreadBinding({ teamId, channelId, threadTs })
    if (!shouldProcessMessage(event, Boolean(existingBinding), deps.botUserId)) {
      await deps.store.markInboundEventIgnored(id, 'message did not mention the bot and thread is not bound')
      return
    }

    const text = stripBotMention(event.text ?? '', deps.botUserId)
    if (!text) {
      await deps.store.markInboundEventIgnored(id, 'message text was empty after mention cleanup')
      return
    }

    // Acknowledge that we picked up the message. Best-effort: requires the
    // reactions:write scope, and a missing scope must not abort processing.
    try {
      await deps.poster.addReaction({ channel: channelId, ts: slackTs, name: 'eyes' })
    } catch (error) {
      console.warn('[slack-channel-bridge] failed to add reaction', error)
    }

    let binding = existingBinding
    if (!binding) {
      const workspaceBinding = await deps.store.getWorkspaceBinding(teamId, channelId)
      if (!workspaceBinding) {
        await deps.poster.postMessage({
          channel: channelId,
          threadTs,
          text: 'This channel is not bound to a Cradle workspace. Run `/cradle bind workspace <workspace-id>` first.',
        })
        await deps.store.markInboundEventIgnored(id, 'channel has no workspace binding')
        return
      }
      const sessionDefaults = sessionDefaultsFromBinding(workspaceBinding)
      if (!sessionDefaults) {
        const sessionTargets = await deps.cradle.listSessionTargets()
        await deps.poster.postMessage({
          channel: channelId,
          threadTs,
          text: 'Choose a default Cradle runtime for this Slack channel before starting a new Cradle session.',
          blocks: buildSessionTargetSelectBlocks({
            binding: workspaceBinding,
            targets: sessionTargets,
            prompt: 'Choose a default Cradle runtime for this Slack channel before starting a new Cradle session.',
          }),
        })
        await deps.store.markInboundEventIgnored(id, 'channel has no session target binding')
        return
      }
      const session = await deps.cradle.createSlackBackedSession({
        workspaceId: workspaceBinding.cradleWorkspaceId,
        title: titleFromSlackText(text),
        sessionDefaults,
      })
      binding = await deps.store.createThreadBinding({
        teamId,
        channelId,
        threadTs,
        cradleSessionId: session.id,
        cradleWorkspaceId: workspaceBinding.cradleWorkspaceId,
        createdBySlackUserId: event.user ?? null,
      })
    }

    const response = await deps.cradle.sendMessageAndCollectResponse({
      sessionId: binding.cradleSessionId,
      text: buildSlackProvenanceText({
        slackUserId: event.user ?? null,
        channelId,
        text,
      }),
    })
    await deliverResponse({
      store: deps.store,
      poster: deps.poster,
      binding,
      response,
    })
    await deps.store.markInboundEventProcessed(id)
  } catch (error) {
    await deps.store.markInboundEventFailed(id, error instanceof Error ? error.message : String(error))
    throw error
  }
}

export async function retryFailedDeliveries(input: {
  store: BridgeStore
  poster: SlackPoster
}): Promise<void> {
  const attempts: DeliveryAttempt[] = await input.store.listRetryableDeliveryAttempts()
  for (const attempt of attempts) {
    if (!attempt.messageText) {
      continue
    }
    try {
      const posted = await input.poster.postMessage({
        channel: attempt.channelId,
        threadTs: attempt.threadTs,
        text: attempt.messageText,
        blocks: blocksFromAttempt(attempt),
      })
      await input.store.markDeliveryAttemptDelivered(attempt.id, posted.ts)
    } catch (error) {
      await input.store.markDeliveryAttemptFailed(attempt.id, error instanceof Error ? error.message : String(error))
    }
  }
}
