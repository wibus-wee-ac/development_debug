import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  conversationBridgeDeliveryAttempts,
  conversationBridgeInboundEvents,
  conversationBridgeThreadBindings,
  messages,
  providerTargets,
  sessions,
  workspaces,
} from '@cradle/db'
import type { ConversationBridgeDeliveryInput } from '@cradle/plugin-sdk/server'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import { registerConversationBridgeAdapter, resetConversationBridgeAdapterRegistry } from '../../plugins/conversation-adapter-registry'
import { resetPluginRuntimeRegistry } from '../../plugins/runtime-registry'
import {
  stopAllConversationBridgeConnections,
} from './runtime-supervisor'
import * as ConversationBridge from './service'

const chatRuntimeMock = vi.hoisted(() => ({
  streamResponse: vi.fn(),
  waitForRunCompletion: vi.fn(),
}))

vi.mock('../chat-runtime/service', () => chatRuntimeMock)

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir: string
let deliveredMessages: ConversationBridgeDeliveryInput[]

function makeInboundEvent(overrides: Partial<Parameters<typeof ConversationBridge.handleInboundMessage>[0]> = {}) {
  return {
    connectionId: 'connection-1',
    externalEventId: 'event-1',
    externalWorkspaceId: 'external-workspace-1',
    externalChannelId: 'external-channel-1',
    externalThreadId: 'external-thread-1',
    externalMessageId: 'external-message-1',
    externalActorId: 'external-user-1',
    text: 'hello bridge',
    mentionedAdapter: true,
    eventType: 'message',
    payload: { source: 'test' },
    ...overrides,
  }
}

function seedCradleRuntimeTarget(): void {
  const timestamp = Math.floor(Date.now() / 1000)
  db().insert(workspaces).values({
    id: 'workspace-1',
    name: 'Workspace 1',
    path: dataDir,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run()
  db().insert(providerTargets).values({
    id: 'target-1',
    kind: 'manual',
    providerKind: 'openai-compatible',
    displayName: 'Target 1',
    enabled: true,
    connectionConfigJson: '{}',
    enabledModelsJson: '[]',
    customModelsJson: '[]',
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run()
}

function registerFakeAdapter(): void {
  registerConversationBridgeAdapter('@cradle/test-conversation-adapter', {
    id: 'fake',
    platform: 'test',
    label: 'Fake Conversation Adapter',
    createRuntime: () => ({
      async start() {},
      async stop() {},
      async sendMessage(input) {
        deliveredMessages.push(input)
        return { externalMessageId: `delivered-${deliveredMessages.length}` }
      },
    }),
  })
}

describe('conversation bridge service', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-conversation-bridge-'))
    process.env.CRADLE_DATA_DIR = dataDir
    deliveredMessages = []
    registerFakeAdapter()
    chatRuntimeMock.streamResponse.mockImplementation(async ({ sessionId }: { sessionId: string }) => {
      const timestamp = Math.floor(Date.now() / 1000)
      db().insert(messages).values({
        id: 'assistant-message-1',
        sessionId,
        role: 'assistant',
        status: 'complete',
        content: 'Bridge response',
        messageJson: JSON.stringify({
          id: 'assistant-message-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Bridge response' }],
        }),
        createdAt: timestamp,
        updatedAt: timestamp,
      }).run()
      return {
        runId: 'run-1',
        assistantMessageId: 'assistant-message-1',
        userMessageId: 'user-message-1',
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close()
          },
        }),
      }
    })
    chatRuntimeMock.waitForRunCompletion.mockResolvedValue({
      id: 'run-1',
      status: 'completed',
    })
  })

  afterEach(async () => {
    await stopAllConversationBridgeConnections()
    resetConversationBridgeAdapterRegistry()
    resetPluginRuntimeRegistry()
    vi.clearAllMocks()
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    if (previousDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = previousDataDir
    }
  })

  it('records an unbound mentioned channel event as ignored', async () => {
    const connection = ConversationBridge.createConnection({
      platform: 'test',
      adapterOwner: '@cradle/test-conversation-adapter',
      adapterId: 'fake',
      displayName: 'Fake',
      enabled: true,
    })

    await ConversationBridge.handleInboundMessage(makeInboundEvent({ connectionId: connection.id }))

    const event = db()
      .select()
      .from(conversationBridgeInboundEvents)
      .where(eq(conversationBridgeInboundEvents.externalEventId, 'event-1'))
      .get()
    expect(event).toEqual(expect.objectContaining({
      status: 'ignored',
      reason: 'external channel is not bound to a Cradle workspace',
    }))
    expect(db().select().from(conversationBridgeThreadBindings).all()).toHaveLength(0)
    expect(deliveredMessages).toHaveLength(0)
  })

  it('creates one session/thread binding for a bound channel and ignores duplicate events', async () => {
    seedCradleRuntimeTarget()
    const connection = ConversationBridge.createConnection({
      platform: 'test',
      adapterOwner: '@cradle/test-conversation-adapter',
      adapterId: 'fake',
      displayName: 'Fake',
      enabled: true,
    })
    ConversationBridge.bindChannel({
      connectionId: connection.id,
      externalWorkspaceId: 'external-workspace-1',
      externalChannelId: 'external-channel-1',
      cradleWorkspaceId: 'workspace-1',
      sessionProviderTargetId: 'target-1',
      sessionRuntimeKind: 'standard',
    })
    const inboundEvent = makeInboundEvent({ connectionId: connection.id })

    await ConversationBridge.handleInboundMessage(inboundEvent)
    await ConversationBridge.handleInboundMessage(inboundEvent)

    expect(db().select().from(sessions).all()).toEqual([
      expect.objectContaining({
        origin: 'conversation-bridge',
        workspaceId: 'workspace-1',
        providerTargetId: 'target-1',
      }),
    ])
    expect(db().select().from(conversationBridgeThreadBindings).all()).toEqual([
      expect.objectContaining({
        connectionId: connection.id,
        externalThreadId: 'external-thread-1',
      }),
    ])
    expect(db().select().from(conversationBridgeInboundEvents).all()).toHaveLength(1)
    expect(db().select().from(conversationBridgeDeliveryAttempts).all()).toEqual([
      expect.objectContaining({
        status: 'delivered',
        externalMessageId: 'delivered-1',
      }),
    ])
    expect(deliveredMessages).toEqual([
      expect.objectContaining({
        connectionId: connection.id,
        externalThreadId: 'external-thread-1',
        text: 'Bridge response',
      }),
    ])
    expect(chatRuntimeMock.streamResponse).toHaveBeenCalledTimes(1)
    expect(chatRuntimeMock.streamResponse).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('hello bridge'),
    }))
    expect(chatRuntimeMock.streamResponse).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('External channel: external-channel-1'),
    }))
  })
})
