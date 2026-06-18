import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agents, externalProviderRecords, providerTargets } from '@cradle/db'
import type { ExternalProviderRecord } from '@cradle/plugin-sdk/server'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { readSecret } from '../src/modules/secrets/service'
import { registerExternalProviderSource } from '../src/plugins/external-provider-source-registry'

const MODELS_DEV_URL = 'https://models.dev/api.json'

const RuntimeTargetResponseSchema = z.object({
  id: z.string(),
  sourceKey: z.string(),
  externalRecordId: z.string(),
  providerKind: z.enum(['anthropic', 'openai-compatible']),
  displayName: z.string(),
  enabled: z.boolean(),
  credentialRef: z.string().nullable(),
  iconSlug: z.string().nullable(),
  lastResolvedFingerprint: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const ProviderTargetModelSettingsResponseSchema = z.object({
  providerTargetKind: z.enum(['manual', 'external']),
  providerTargetId: z.string(),
  configJson: z.string(),
  customModelsJson: z.string(),
  modelRegistryMappingsJson: z.string(),
})

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function getRequestUrl(input: Parameters<typeof fetch>[0]): string {
  return new Request(input).url
}

function restoreEnv(previous: {
  dataDir?: string
  credentialSecret?: string
  pluginsDir?: string
  externalPluginsDirs?: string
}): void {
  if (previous.dataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
 else {
    process.env.CRADLE_DATA_DIR = previous.dataDir
  }

  if (previous.credentialSecret === undefined) {
    delete process.env.CRADLE_CREDENTIAL_SECRET
  }
 else {
    process.env.CRADLE_CREDENTIAL_SECRET = previous.credentialSecret
  }

  if (previous.pluginsDir === undefined) {
    delete process.env.CRADLE_PLUGINS_DIR
  }
 else {
    process.env.CRADLE_PLUGINS_DIR = previous.pluginsDir
  }

  if (previous.externalPluginsDirs === undefined) {
    delete process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
  }
 else {
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = previous.externalPluginsDirs
  }
}

describe('external provider sources capability', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores external runtime targets without creating manual profiles', async () => {
    const dataDir = makeTempDir('cradle-external-provider-source-')
    const previous = {
      dataDir: process.env.CRADLE_DATA_DIR,
      credentialSecret: process.env.CRADLE_CREDENTIAL_SECRET,
      pluginsDir: process.env.CRADLE_PLUGINS_DIR,
      externalPluginsDirs: process.env.CRADLE_EXTERNAL_PLUGINS_DIRS,
    }
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'external-provider-source-test-secret'
    process.env.CRADLE_PLUGINS_DIR = join(dataDir, 'plugins')
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = ''

    let providers: Array<ExternalProviderRecord & { enabled?: boolean }> = [
      {
        externalId: 'claude:test-anthropic',
        app: 'claude',
        name: 'Fixture Anthropic',
        providerKind: 'anthropic',
        config: { baseUrl: 'https://anthropic.example.test', model: 'claude-test' },
        credential: { kind: 'api-key', value: 'test-secret-value', label: 'Fixture Anthropic' },
        enabled: false,
        metadata: {
          baseUrl: 'https://anthropic.example.test',
          model: 'claude-test',
          iconSlug: 'anthropic',
        },
      },
      {
        externalId: 'codex:test-openai',
        app: 'codex',
        name: 'Fixture OpenAI',
        providerKind: 'openai-compatible',
        config: { baseUrl: 'https://openai.example.test', model: 'gpt-test', apiMode: 'responses' },
        credential: { kind: 'api-key', value: 'test-secret-value', label: 'Fixture OpenAI' },
        metadata: {
          baseUrl: 'https://openai.example.test',
          model: 'gpt-test',
          apiFormat: 'openai_responses',
          iconSlug: 'codex',
          iconUrl: 'https://icons.example.test/codex.png',
        },
      },
    ]

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const registration = registerExternalProviderSource('fixture-plugin', {
        id: 'fixture-providers',
        label: 'Fixture Providers',
        capabilities: { refresh: true },
        async readSnapshot() {
          return {
            source: { status: 'ok', observedAt: '2026-05-21T09:37:00Z' },
            inventory: { mcpServers: 2, prompts: 1, skills: 3 },
            providers,
          }
        },
      })

      const sourcesBeforeRefresh = await app.handle(
        new Request('http://localhost/external-provider-sources'),
      )
      expect(sourcesBeforeRefresh.status).toBe(200)
      const sourceList = (await sourcesBeforeRefresh.json()) as Array<{
        id: string
        label: string
        lastSyncStatus: string
      }>
      expect(sourceList).toEqual([
        expect.objectContaining({
          label: 'Fixture Providers',
          lastSyncStatus: 'never',
        }),
      ])
      const sourceKey = sourceList[0].id

      const refresh = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST',
        }),
      )
      expect(refresh.status).toBe(200)
      expect(await refresh.json()).toEqual(
        expect.objectContaining({
          sourceKey,
          status: 'ok',
          recordsSeen: 2,
          recordsProjected: 2,
          recordsMissing: 0,
        }),
      )

      const recordsRes = await app.handle(
        new Request('http://localhost/external-provider-sources/records'),
      )
      expect(recordsRes.status).toBe(200)
      const records = (await recordsRes.json()) as Array<{ externalId: string, status: string }>
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ externalId: 'claude:test-anthropic', status: 'active' }),
          expect.objectContaining({ externalId: 'codex:test-openai', status: 'active' }),
        ]),
      )

      const profilesRes = await app.handle(new Request('http://localhost/profiles'))
      expect(profilesRes.status).toBe(200)
      const profiles = (await profilesRes.json()) as Array<unknown>
      expect(profiles).toEqual([])
      expect(JSON.stringify(records)).not.toContain('test-secret-value')

      const anthropicTargetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/claude:test-anthropic/runtime-target`,
        ),
      )
      expect(anthropicTargetRes.status).toBe(200)
      const anthropicTarget = RuntimeTargetResponseSchema.parse(await anthropicTargetRes.json())
      expect(anthropicTarget).toEqual(
        expect.objectContaining({
          sourceKey,
          externalRecordId: 'claude:test-anthropic',
          providerKind: 'anthropic',
          displayName: 'Fixture Anthropic',
          enabled: true,
          credentialRef: expect.stringMatching(/^external_credential_/),
          iconSlug: 'anthropic',
        }),
      )

      const createAgent = await app.handle(
        new Request('http://localhost/agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Fixture Claude Agent',
            avatarStyle: 'bottts-neutral',
            avatarSeed: 'fixture-claude-agent',
            providerTargetId: anthropicTarget.id,
            runtimeKind: 'claude-agent',
          }),
        }),
      )
      expect(createAgent.status).toBe(200)
      const agent = (await createAgent.json()) as { id: string, enabled: boolean }
      expect(agent.enabled).toBe(true)

      const disableAnthropicTarget = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/claude:test-anthropic/runtime-target`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: false }),
          },
        ),
      )
      expect(disableAnthropicTarget.status).toBe(200)
      expect(RuntimeTargetResponseSchema.parse(await disableAnthropicTarget.json())).toEqual(
        expect.objectContaining({
          externalRecordId: 'claude:test-anthropic',
          enabled: false,
        }),
      )

      expect(db().select().from(agents).where(eq(agents.id, agent.id)).get()).toEqual(
        expect.objectContaining({
          id: agent.id,
          providerTargetId: anthropicTarget.id,
          enabled: false,
        }),
      )

      const reenableAgent = await app.handle(
        new Request(`http://localhost/agents/${agent.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        }),
      )
      expect(reenableAgent.status).toBe(200)
      expect(await reenableAgent.json()).toEqual(
        expect.objectContaining({
          id: agent.id,
          enabled: false,
        }),
      )

      const createSessionWithDisabledAgent = await app.handle(
        new Request('http://localhost/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: 'Disabled provider session',
            agentId: agent.id,
          }),
        }),
      )
      expect(createSessionWithDisabledAgent.status).toBe(409)

      const refreshAfterDisable = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST',
        }),
      )
      expect(refreshAfterDisable.status).toBe(200)
      const disabledTargetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/claude:test-anthropic/runtime-target`,
        ),
      )
      expect(disabledTargetRes.status).toBe(200)
      expect(RuntimeTargetResponseSchema.parse(await disabledTargetRes.json())).toEqual(
        expect.objectContaining({
          externalRecordId: 'claude:test-anthropic',
          enabled: false,
        }),
      )

      const recordsAfterDisableRes = await app.handle(
        new Request('http://localhost/external-provider-sources/records'),
      )
      expect(recordsAfterDisableRes.status).toBe(200)
      expect(await recordsAfterDisableRes.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            externalId: 'claude:test-anthropic',
            runtimeTargetEnabled: false,
          }),
        ]),
      )

      const openAiTargetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/codex:test-openai/runtime-target`,
        ),
      )
      expect(openAiTargetRes.status).toBe(200)
      expect(RuntimeTargetResponseSchema.parse(await openAiTargetRes.json())).toEqual(
        expect.objectContaining({
          sourceKey,
          externalRecordId: 'codex:test-openai',
          providerKind: 'openai-compatible',
          displayName: 'Fixture OpenAI',
          iconSlug: 'codex',
        }),
      )

      providers = [providers[0]]
      const missingRefresh = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST',
        }),
      )
      expect(missingRefresh.status).toBe(200)
      expect(await missingRefresh.json()).toEqual(expect.objectContaining({ recordsMissing: 1 }))

      const missingTargetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/codex:test-openai/runtime-target`,
        ),
      )
      expect(missingTargetRes.status).toBe(200)
      expect(RuntimeTargetResponseSchema.parse(await missingTargetRes.json())).toEqual(
        expect.objectContaining({
          externalRecordId: 'codex:test-openai',
          enabled: false,
        }),
      )

      registration.dispose()
    }
 finally {
      shutdownInfra()
      restoreEnv(previous)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('stores external ChatGPT auth credentials as encrypted runtime target secrets', async () => {
    const dataDir = makeTempDir('cradle-external-provider-source-chatgpt-auth-')
    const previous = {
      dataDir: process.env.CRADLE_DATA_DIR,
      credentialSecret: process.env.CRADLE_CREDENTIAL_SECRET,
      pluginsDir: process.env.CRADLE_PLUGINS_DIR,
      externalPluginsDirs: process.env.CRADLE_EXTERNAL_PLUGINS_DIRS,
    }
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'external-provider-source-chatgpt-auth-secret'
    process.env.CRADLE_PLUGINS_DIR = join(dataDir, 'plugins')
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = ''

    const chatgptSecret = JSON.stringify({
      kind: 'chatgpt-auth',
      accessToken: 'fixture-access-token',
      refreshToken: 'fixture-refresh-token',
      chatgptAccountId: 'fixture-chatgpt-account',
      chatgptPlanType: 'plus',
    })

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const registration = registerExternalProviderSource('fixture-chatgpt-auth-plugin', {
        id: 'fixture-chatgpt-auth-providers',
        label: 'Fixture ChatGPT Auth Providers',
        capabilities: { refresh: true },
        async readSnapshot() {
          return {
            source: { status: 'ok', observedAt: '2026-06-11T00:00:00Z' },
            providers: [{
              externalId: 'codex:chatgpt-auth',
              app: 'codex',
              name: 'Fixture ChatGPT Auth',
              providerKind: 'openai-compatible',
              config: { model: 'gpt-5-codex' },
              credential: { kind: 'chatgpt-auth', value: chatgptSecret, label: 'Fixture ChatGPT Auth' },
              metadata: { apiFormat: 'openai_chat' },
            }],
          }
        },
      })

      const sourcesRes = await app.handle(new Request('http://localhost/external-provider-sources'))
      expect(sourcesRes.status).toBe(200)
      const sourceList = (await sourcesRes.json()) as Array<{ id: string, label: string }>
      const sourceKey = sourceList.find(source => source.label === 'Fixture ChatGPT Auth Providers')?.id
      expect(sourceKey).toBeTruthy()

      const refresh = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST',
        }),
      )
      expect(refresh.status).toBe(200)
      expect(await refresh.json()).toEqual(expect.objectContaining({
        sourceKey,
        status: 'ok',
        recordsSeen: 1,
        recordsProjected: 1,
      }))

      const targetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/codex:chatgpt-auth/runtime-target`,
        ),
      )
      expect(targetRes.status).toBe(200)
      const target = RuntimeTargetResponseSchema.parse(await targetRes.json())
      expect(target.credentialRef).toEqual(expect.stringMatching(/^external_credential_/))
      expect(JSON.parse(readSecret(target.credentialRef!))).toEqual(expect.objectContaining({
        kind: 'chatgpt-auth',
        accessToken: 'fixture-access-token',
        refreshToken: 'fixture-refresh-token',
        chatgptAccountId: 'fixture-chatgpt-account',
        chatgptPlanType: 'plus',
      }))

      registration.dispose()
    }
    finally {
      shutdownInfra()
      restoreEnv(previous)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('records source errors without deleting previous runtime targets', async () => {
    const dataDir = makeTempDir('cradle-external-provider-source-error-')
    const previous = {
      dataDir: process.env.CRADLE_DATA_DIR,
      credentialSecret: process.env.CRADLE_CREDENTIAL_SECRET,
      pluginsDir: process.env.CRADLE_PLUGINS_DIR,
      externalPluginsDirs: process.env.CRADLE_EXTERNAL_PLUGINS_DIRS,
    }
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'external-provider-source-error-secret'
    process.env.CRADLE_PLUGINS_DIR = join(dataDir, 'plugins')
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = ''

    let shouldFail = false

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const registration = registerExternalProviderSource('fixture-error-plugin', {
        id: 'fixture-error-providers',
        label: 'Fixture Error Providers',
        async readSnapshot() {
          if (shouldFail) {
            throw new Error('fixture source unavailable')
          }
          return {
            source: { status: 'ok' },
            providers: [
              {
                externalId: 'codex:error-openai',
                app: 'codex',
                name: 'Error Fixture OpenAI',
                providerKind: 'openai-compatible',
                config: { baseUrl: 'https://error.example.test', model: 'gpt-test' },
              },
            ],
          }
        },
      })

      const sources = (await (
        await app.handle(new Request('http://localhost/external-provider-sources'))
      ).json()) as Array<{ id: string }>
      const sourceKey = sources[0].id

      const firstRefresh = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST',
        }),
      )
      expect(firstRefresh.status).toBe(200)

      shouldFail = true
      const failedRefresh = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST',
        }),
      )
      expect(failedRefresh.status).toBe(200)
      expect(await failedRefresh.json()).toEqual(
        expect.objectContaining({
          status: 'error',
          message: 'fixture source unavailable',
        }),
      )

      const profilesRes = await app.handle(new Request('http://localhost/profiles'))
      expect(profilesRes.status).toBe(200)
      expect(await profilesRes.json()).toEqual([])

      const targetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/codex:error-openai/runtime-target`,
        ),
      )
      expect(targetRes.status).toBe(200)
      expect(RuntimeTargetResponseSchema.parse(await targetRes.json())).toEqual(
        expect.objectContaining({
          externalRecordId: 'codex:error-openai',
          displayName: 'Error Fixture OpenAI',
          enabled: true,
        }),
      )

      const sourceList = await app.handle(new Request('http://localhost/external-provider-sources'))
      expect(sourceList.status).toBe(200)
      expect(await sourceList.json()).toEqual([
        expect.objectContaining({
          lastSyncStatus: 'error',
          lastSyncError: 'fixture source unavailable',
        }),
      ])

      registration.dispose()
    }
 finally {
      shutdownInfra()
      restoreEnv(previous)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('refreshes legacy external records and targets by source record identity', async () => {
    const dataDir = makeTempDir('cradle-external-provider-source-legacy-')
    const previous = {
      dataDir: process.env.CRADLE_DATA_DIR,
      credentialSecret: process.env.CRADLE_CREDENTIAL_SECRET,
      pluginsDir: process.env.CRADLE_PLUGINS_DIR,
      externalPluginsDirs: process.env.CRADLE_EXTERNAL_PLUGINS_DIRS,
    }
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'external-provider-source-legacy-secret'
    process.env.CRADLE_PLUGINS_DIR = join(dataDir, 'plugins')
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = ''

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const registration = registerExternalProviderSource('fixture-legacy-plugin', {
        id: 'fixture-legacy-providers',
        label: 'Fixture Legacy Providers',
        async readSnapshot() {
          return {
            source: { status: 'ok' },
            providers: [
              {
                externalId: 'codex:legacy-openai',
                app: 'codex',
                name: 'Updated Legacy OpenAI',
                providerKind: 'openai-compatible',
                config: { baseUrl: 'https://legacy.example.test/v1', model: 'gpt-legacy' },
                metadata: {
                  baseUrl: 'https://legacy.example.test/v1',
                  model: 'gpt-legacy',
                },
              },
            ],
          }
        },
      })

      const sources = (await (
        await app.handle(new Request('http://localhost/external-provider-sources'))
      ).json()) as Array<{ id: string }>
      const sourceKey = sources[0].id
      const now = Math.floor(Date.now() / 1000)

      db()
        .insert(externalProviderRecords)
        .values({
          id: 'legacy-record-id',
          sourceKey,
          externalId: 'codex:legacy-openai',
          app: 'codex',
          name: 'Legacy OpenAI',
          providerKind: 'openai-compatible',
          status: 'missing',
          fingerprint: 'legacy-record-fingerprint',
          metadataJson: '{}',
          warningsJson: '[]',
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      db()
        .insert(providerTargets)
        .values({
          id: 'legacy-target-id',
          kind: 'external',
          sourceKey,
          externalRecordId: 'codex:legacy-openai',
          providerKind: 'openai-compatible',
          displayName: 'Legacy OpenAI',
          enabled: false,
          connectionConfigJson: '{}',
          credentialRef: null,
          enabledModelsJson: '[]',
          customModelsJson: '[]',
          modelRegistryMappingsJson: '[]',
          iconSlug: null,
          sourceFingerprint: 'legacy-target-fingerprint',
          createdAt: now,
          updatedAt: now,
        })
        .run()

      const refresh = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST',
        }),
      )
      expect(refresh.status).toBe(200)
      expect(await refresh.json()).toEqual(
        expect.objectContaining({
          sourceKey,
          status: 'ok',
          recordsSeen: 1,
          recordsProjected: 1,
          recordsMissing: 0,
        }),
      )

      const recordsRes = await app.handle(
        new Request('http://localhost/external-provider-sources/records'),
      )
      expect(recordsRes.status).toBe(200)
      expect(await recordsRes.json()).toEqual([
        expect.objectContaining({
          id: 'legacy-record-id',
          providerTargetId: 'legacy-target-id',
          externalId: 'codex:legacy-openai',
          name: 'Updated Legacy OpenAI',
          status: 'active',
        }),
      ])

      const targetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/codex:legacy-openai/runtime-target`,
        ),
      )
      expect(targetRes.status).toBe(200)
      expect(RuntimeTargetResponseSchema.parse(await targetRes.json())).toEqual(
        expect.objectContaining({
          id: 'legacy-target-id',
          externalRecordId: 'codex:legacy-openai',
          displayName: 'Updated Legacy OpenAI',
          enabled: false,
        }),
      )

      registration.dispose()
    }
 finally {
      shutdownInfra()
      restoreEnv(previous)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('resolves provider target config and secret for provider operations', async () => {
    const dataDir = makeTempDir('cradle-external-provider-target-ops-')
    const previous = {
      dataDir: process.env.CRADLE_DATA_DIR,
      credentialSecret: process.env.CRADLE_CREDENTIAL_SECRET,
      pluginsDir: process.env.CRADLE_PLUGINS_DIR,
      externalPluginsDirs: process.env.CRADLE_EXTERNAL_PLUGINS_DIRS,
    }
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'external-provider-target-secret'
    process.env.CRADLE_PLUGINS_DIR = join(dataDir, 'plugins')
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = ''

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getRequestUrl(input)
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      expect(url).toBe('https://target-openai.example.test/v1/models')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer target-secret-value' })
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-4.1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const registration = registerExternalProviderSource('fixture-target-plugin', {
        id: 'fixture-target-providers',
        label: 'Fixture Target Providers',
        async readSnapshot() {
          return {
            source: { status: 'ok' },
            providers: [
              {
                externalId: 'codex:target-openai',
                app: 'codex',
                name: 'Target OpenAI',
                providerKind: 'openai-compatible',
                config: { baseUrl: 'https://target-openai.example.test/v1', model: 'gpt-4.1' },
                credential: {
                  kind: 'api-key',
                  value: 'target-secret-value',
                  label: 'Target OpenAI',
                },
              },
            ],
          }
        },
      })

      const sources = (await (
        await app.handle(new Request('http://localhost/external-provider-sources'))
      ).json()) as Array<{ id: string }>
      const sourceKey = sources[0].id

      const refresh = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST',
        }),
      )
      expect(refresh.status).toBe(200)

      const targetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/codex:target-openai/runtime-target`,
        ),
      )
      expect(targetRes.status).toBe(200)
      const target = RuntimeTargetResponseSchema.parse(await targetRes.json())

      const modelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerKind: 'openai-compatible',
            label: 'ignored',
            config: {},
            secretRef: null,
            providerTargetKind: 'external',
            providerTargetId: target.id,
          }),
        }),
      )
      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({ id: 'gpt-4.1-mini', providerKind: 'openai-compatible' }),
        expect.objectContaining({ id: 'gpt-4.1', providerKind: 'openai-compatible' }),
      ])

      const visibilityRes = await app.handle(
        new Request(`http://localhost/provider-targets/${target.id}/model-visibility`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabledModels: ['gpt-4.1'] }),
        }),
      )
      expect(visibilityRes.status).toBe(200)
      const visibilitySettings = ProviderTargetModelSettingsResponseSchema.parse(
        await visibilityRes.json(),
      )
      expect(JSON.parse(visibilitySettings.configJson)).toEqual(
        expect.objectContaining({
          baseUrl: 'https://target-openai.example.test/v1',
          model: 'gpt-4.1',
          enabledModels: ['gpt-4.1'],
        }),
      )

      const customModelsRes = await app.handle(
        new Request(`http://localhost/provider-targets/${target.id}/custom-models`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            models: [
              {
                id: 'provider-private-model',
                label: 'Provider Private Model',
                capabilities: { contextWindow: 64000 },
              },
            ],
          }),
        }),
      )
      expect(customModelsRes.status).toBe(200)
      expect(await customModelsRes.json()).toEqual([
        expect.objectContaining({ id: 'provider-private-model', label: 'Provider Private Model' }),
      ])

      const mappingRes = await app.handle(
        new Request(`http://localhost/provider-targets/${target.id}/model-registry-mappings`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            modelId: 'gpt-4.1-mini',
            model: {
              id: 'gpt-4.1-mini',
              name: 'GPT-4.1 Mini',
              limit: { context: 1047576, output: 32768 },
              modalities: { input: ['text'], output: ['text'] },
              tool_call: true,
            },
          }),
        }),
      )
      expect(mappingRes.status).toBe(200)
      expect(await mappingRes.json()).toEqual([
        expect.objectContaining({ modelId: 'gpt-4.1-mini', registryModelId: 'gpt-4.1-mini' }),
      ])

      const mappedModelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerKind: 'openai-compatible',
            label: 'ignored',
            config: {},
            secretRef: null,
            providerTargetKind: 'external',
            providerTargetId: target.id,
          }),
        }),
      )
      expect(mappedModelsRes.status).toBe(200)
      expect(await mappedModelsRes.json()).toEqual([
        expect.objectContaining({
          id: 'gpt-4.1-mini',
          label: 'GPT-4.1 Mini',
          capabilities: expect.objectContaining({
            registryMatch: 'manual',
            contextWindow: 1047576,
          }),
        }),
        expect.objectContaining({ id: 'gpt-4.1', providerKind: 'openai-compatible' }),
        expect.objectContaining({ id: 'provider-private-model', label: 'Provider Private Model' }),
      ])

      const refreshAfterPreferences = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST',
        }),
      )
      expect(refreshAfterPreferences.status).toBe(200)
      const settingsAfterRefreshRes = await app.handle(
        new Request(`http://localhost/provider-targets/${target.id}/model-settings`),
      )
      expect(settingsAfterRefreshRes.status).toBe(200)
      const settingsAfterRefresh = ProviderTargetModelSettingsResponseSchema.parse(
        await settingsAfterRefreshRes.json(),
      )
      expect(JSON.parse(settingsAfterRefresh.configJson)).toEqual(
        expect.objectContaining({
          enabledModels: ['gpt-4.1'],
        }),
      )
      expect(JSON.parse(settingsAfterRefresh.customModelsJson)).toEqual([
        expect.objectContaining({ id: 'provider-private-model' }),
      ])
      expect(JSON.parse(settingsAfterRefresh.modelRegistryMappingsJson)).toEqual([
        expect.objectContaining({ modelId: 'gpt-4.1-mini', registryModelId: 'gpt-4.1-mini' }),
      ])

      const providerFetchCount = fetchSpy.mock.calls.filter(
        ([callInput]) => getRequestUrl(callInput) === 'https://target-openai.example.test/v1/models',
      ).length
      expect(providerFetchCount).toBe(2)

      registration.dispose()
    }
 finally {
      shutdownInfra()
      restoreEnv(previous)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
