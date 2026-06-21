import type {
  ConversationBridgeAdapterRegistration,
  ConversationBridgeAdapterRuntime,
  ConversationBridgeAdapterRuntimeContext,
  ConversationBridgeConnectionRuntimeConfig,
  ConversationBridgeDeliveryInput,
  ConversationBridgeDeliveryResult,
  ConversationBridgeHost,
  NormalizedConversationInboundMessage,
} from '@cradle/plugin-sdk/server'

type SlackEventName = 'app_mention' | 'message'
type SlackLogLevel = 'debug' | 'info' | 'warn' | 'error'
type SlackBoltModule = typeof import('@slack/bolt')
type SlackFormatModule = typeof import('./format')

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

export interface SlackAppLike {
  client: {
    auth: {
      test: () => Promise<{ user_id?: string, team_id?: string, enterprise_id?: string | null }>
    }
    chat: {
      postMessage: (input: {
        channel: string
        thread_ts: string
        text: string
        blocks?: unknown[]
      }) => Promise<{ ts?: string }>
    }
    reactions?: {
      add: (input: {
        channel: string
        timestamp: string
        name: string
      }) => Promise<unknown>
    }
  }
  event: (name: SlackEventName, handler: (input: { body: SlackEventEnvelope }) => Promise<void>) => void
  start: () => Promise<void>
  stop: () => Promise<void>
}

export interface SlackAppFactoryInput {
  botToken: string
  appToken: string
  signingSecret: string
  logLevel: SlackLogLevel
}

export type SlackAppFactory = (input: SlackAppFactoryInput) => SlackAppLike | Promise<SlackAppLike>

interface RunningSlackConnection {
  app: SlackAppLike
  botUserId: string | null
}

function toBoltLogLevel(value: unknown): SlackLogLevel {
  switch (value) {
    case 'debug':
      return 'debug'
    case 'warn':
      return 'warn'
    case 'error':
      return 'error'
    case 'info':
    default:
      return 'info'
  }
}

async function defaultSlackAppFactory(input: SlackAppFactoryInput): Promise<SlackAppLike> {
  const { App, LogLevel } = await import('@slack/bolt') as SlackBoltModule
  const logLevel = (() => {
    switch (input.logLevel) {
      case 'debug':
        return LogLevel.DEBUG
      case 'warn':
        return LogLevel.WARN
      case 'error':
        return LogLevel.ERROR
      case 'info':
      default:
        return LogLevel.INFO
    }
  })()
  const app = new App({
    token: input.botToken,
    appToken: input.appToken,
    signingSecret: input.signingSecret,
    socketMode: true,
    logLevel,
  })
  return {
    client: app.client,
    event(name, handler) {
      app.event(name, async ({ body }) => {
        await handler({ body: body as SlackEventEnvelope })
      })
    },
    async start() {
      await app.start()
    },
    async stop() {
      await app.stop()
    },
  }
}

function requireSecret(connection: ConversationBridgeConnectionRuntimeConfig, name: string): string {
  const value = connection.secrets[name]?.trim()
  if (!value) {
    throw new Error(`Slack connection ${connection.id} is missing required secret: ${name}`)
  }
  return value
}

function isIgnorableMessage(event: SlackMessageEvent): boolean {
  return Boolean(
    event.bot_id
    || event.subtype === 'bot_message'
    || event.subtype === 'message_changed'
    || event.subtype === 'message_deleted',
  )
}

function eventIdFor(envelope: SlackEventEnvelope, teamId: string, event: SlackMessageEvent): string {
  return envelope.event_id ?? `${teamId}:${event.channel ?? 'unknown'}:${event.ts ?? 'unknown'}:${event.subtype ?? event.type ?? 'message'}`
}

function isMentioned(event: SlackMessageEvent, botUserId?: string | null): boolean {
  if (event.type === 'app_mention') {
    return true
  }
  return Boolean(botUserId && event.text?.includes(`<@${botUserId}>`))
}

function stripBotMention(text: string, botUserId?: string | null): string {
  let cleaned = text
  if (botUserId) {
    cleaned = cleaned.replace(new RegExp(`<@${botUserId}>`, 'g'), '')
  }
  return cleaned.trim()
}

export function normalizeSlackMessageEvent(input: {
  connectionId: string
  envelope: SlackEventEnvelope
  botUserId?: string | null
}): NormalizedConversationInboundMessage | null {
  const { connectionId, envelope, botUserId } = input
  const event = envelope.event
  const teamId = envelope.team_id
  const channelId = event.channel
  const messageTs = event.ts
  const threadTs = event.thread_ts ?? event.ts

  if (!teamId || !channelId || !messageTs || !threadTs) {
    return null
  }
  if (isIgnorableMessage(event)) {
    return null
  }

  const text = stripBotMention(event.text ?? '', botUserId)
  if (!text) {
    return null
  }

  return {
    connectionId,
    externalEventId: eventIdFor(envelope, teamId, event),
    externalWorkspaceId: teamId,
    externalChannelId: channelId,
    externalThreadId: threadTs,
    externalMessageId: messageTs,
    externalActorId: event.user ?? null,
    text,
    mentionedAdapter: isMentioned(event, botUserId),
    eventType: event.type ?? 'message',
    payload: {
      slack: {
        teamId,
        channelId,
        messageTs,
        threadTs,
        eventType: event.type ?? 'message',
        subtype: event.subtype ?? null,
      },
    },
  }
}

export class SlackConversationBridgeRuntime implements ConversationBridgeAdapterRuntime {
  private readonly connections = new Map<string, RunningSlackConnection>()

  constructor(
    private readonly ctx: ConversationBridgeAdapterRuntimeContext,
    private readonly createApp: SlackAppFactory = defaultSlackAppFactory,
  ) {}

  async start(connection: ConversationBridgeConnectionRuntimeConfig, host: ConversationBridgeHost): Promise<void> {
    if (this.connections.has(connection.id)) {
      return
    }

    host.reportConnectionHealth({
      connectionId: connection.id,
      status: 'starting',
      message: null,
    })

    let botUserId: string | null = null
    const app = await this.createApp({
      botToken: requireSecret(connection, 'botToken'),
      appToken: requireSecret(connection, 'appToken'),
      signingSecret: requireSecret(connection, 'signingSecret'),
      logLevel: toBoltLogLevel(connection.config.logLevel),
    })

    const handleEnvelope = async (envelope: SlackEventEnvelope) => {
      const normalized = normalizeSlackMessageEvent({
        connectionId: connection.id,
        envelope,
        botUserId,
      })
      if (!normalized) {
        return
      }
      try {
        await app.client.reactions?.add({
          channel: normalized.externalChannelId,
          timestamp: normalized.externalMessageId,
          name: 'eyes',
        })
      }
      catch (error) {
        this.ctx.logger.debug('Slack reaction acknowledgement failed', error)
      }
      await host.handleInboundMessage(normalized)
    }

    app.event('app_mention', async ({ body }) => handleEnvelope(body))
    app.event('message', async ({ body }) => handleEnvelope(body))

    const auth = await app.client.auth.test()
    botUserId = auth.user_id ?? null
    await app.start()
    this.connections.set(connection.id, { app, botUserId })

    host.reportConnectionHealth({
      connectionId: connection.id,
      status: 'running',
      message: auth.team_id ? `Connected to Slack workspace ${auth.team_id}` : null,
    })
  }

  async stop(connectionId: string): Promise<void> {
    const running = this.connections.get(connectionId)
    if (!running) {
      return
    }
    this.connections.delete(connectionId)
    await running.app.stop()
  }

  async sendMessage(input: ConversationBridgeDeliveryInput): Promise<ConversationBridgeDeliveryResult> {
    const running = this.connections.get(input.connectionId)
    if (!running) {
      throw new Error(`Slack connection is not running: ${input.connectionId}`)
    }

    const { renderMarkdownForSlack } = await import('./format') as SlackFormatModule
    const postedMessageIds: string[] = []
    const messages = renderMarkdownForSlack(input.text)
    for (const message of messages) {
      const posted = await running.app.client.chat.postMessage({
        channel: input.externalChannelId,
        thread_ts: input.externalThreadId,
        text: message.text,
        blocks: message.blocks,
      })
      if (posted.ts) {
        postedMessageIds.push(posted.ts)
      }
    }

    return {
      externalMessageId: postedMessageIds.at(-1) ?? null,
      payload: {
        slack: {
          postedMessageIds,
        },
      },
    }
  }
}

export function createSlackConversationAdapter(
  createApp?: SlackAppFactory,
): ConversationBridgeAdapterRegistration {
  return {
    id: 'slack',
    platform: 'slack',
    label: 'Slack',
    description: 'Slack Socket Mode conversation adapter for Cradle conversation bridge',
    capabilities: {
      realtime: 'socket',
      channelBinding: true,
      threadBinding: true,
      interactiveControls: false,
    },
    createRuntime: ctx => new SlackConversationBridgeRuntime(ctx, createApp),
  }
}
