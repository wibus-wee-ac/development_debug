import { App, LogLevel } from '@slack/bolt'

import type { BridgeConfig } from '../config'
import type { BridgeStore } from '../store'
import type { CradleService } from '../cradle/service'
import {
  CRADLE_CHANNEL_UNBIND_ACTION,
  CRADLE_STATUS_REFRESH_ACTION,
  handleCradleChannelUnbindAction,
  handleCradleCommand,
  handleCradleStatusRefreshAction,
} from './commands'
import { handleSlackMessageEvent, retryFailedDeliveries, type SlackPoster } from './events'

function toBoltLogLevel(level: BridgeConfig['logLevel']): LogLevel {
  switch (level) {
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
}

export interface SlackBridgeApp {
  start(): Promise<void>
  stop(): Promise<void>
}

export function createSlackBridgeApp(input: {
  config: BridgeConfig
  store: BridgeStore
  cradle: CradleService
}): SlackBridgeApp {
  const app = new App({
    token: input.config.slackBotToken,
    appToken: input.config.slackAppToken,
    signingSecret: input.config.slackSigningSecret,
    socketMode: true,
    logLevel: toBoltLogLevel(input.config.logLevel),
  })

  let botUserId: string | null = null

  const poster: SlackPoster = {
    async postMessage(message) {
      const result = await app.client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.threadTs,
        text: message.text,
        blocks: message.blocks,
      })
      return { ts: String(result.ts ?? '') }
    },
    async addReaction(reaction) {
      await app.client.reactions.add({
        channel: reaction.channel,
        timestamp: reaction.ts,
        name: reaction.name,
      })
    },
  }

  app.command('/cradle', async ({ command, ack, respond }) => {
    await ack()
    await handleCradleCommand(command, respond, {
      store: input.store,
      cradle: input.cradle,
    })
  })

  app.action(CRADLE_STATUS_REFRESH_ACTION, async ({ body, ack, respond }) => {
    await ack()
    await handleCradleStatusRefreshAction(body, respond, {
      store: input.store,
      cradle: input.cradle,
    })
  })

  app.action(CRADLE_CHANNEL_UNBIND_ACTION, async ({ body, ack, respond }) => {
    await ack()
    await handleCradleChannelUnbindAction(body, respond, {
      store: input.store,
      cradle: input.cradle,
    })
  })

  app.event('app_mention', async ({ body }) => {
    await handleSlackMessageEvent(body as any, {
      store: input.store,
      cradle: input.cradle,
      poster,
      botUserId,
    })
  })

  app.event('message', async ({ body }) => {
    await handleSlackMessageEvent(body as any, {
      store: input.store,
      cradle: input.cradle,
      poster,
      botUserId,
    })
  })

  return {
    async start() {
      const auth = await app.client.auth.test()
      botUserId = auth.user_id ?? null
      if (auth.team_id) {
        await input.store.upsertInstallation({
          teamId: auth.team_id,
          enterpriseId: auth.enterprise_id ?? null,
          botUserId,
        })
      }
      await app.start()
      await retryFailedDeliveries({ store: input.store, poster })
      console.warn('[slack-channel-bridge] started')
    },
    async stop() {
      await app.stop()
      console.warn('[slack-channel-bridge] stopped')
    },
  }
}
