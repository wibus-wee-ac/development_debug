import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ExternalProviderRecord } from '@cradle/plugin-sdk/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'
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
  updatedAt: z.number()
})

const ProviderTargetModelSettingsResponseSchema = z.object({
  providerTargetKind: z.enum(['manual-profile', 'external-record']),
  providerTargetId: z.string(),
  configJson: z.string(),
  customModelsJson: z.string(),
  modelRegistryMappingsJson: z.string()
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
  } else {
    process.env.CRADLE_DATA_DIR = previous.dataDir
  }

  if (previous.credentialSecret === undefined) {
    delete process.env.CRADLE_CREDENTIAL_SECRET
  } else {
    process.env.CRADLE_CREDENTIAL_SECRET = previous.credentialSecret
  }

  if (previous.pluginsDir === undefined) {
    delete process.env.CRADLE_PLUGINS_DIR
  } else {
    process.env.CRADLE_PLUGINS_DIR = previous.pluginsDir
  }

  if (previous.externalPluginsDirs === undefined) {
    delete process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
  } else {
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
      externalPluginsDirs: process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
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
          health: 'unknown'
        }
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
          apiFormat: 'openai_responses'
        }
      }
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
            providers
          }
        }
      })

      const sourcesBeforeRefresh = await app.handle(
        new Request('http://localhost/external-provider-sources')
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
          lastSyncStatus: 'never'
        })
      ])
      const sourceKey = sourceList[0].id

      const refresh = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST'
        })
      )
      expect(refresh.status).toBe(200)
      expect(await refresh.json()).toEqual(
        expect.objectContaining({
          sourceKey,
          status: 'ok',
          recordsSeen: 2,
          recordsProjected: 2,
          recordsMissing: 0
        })
      )

      const recordsRes = await app.handle(
        new Request('http://localhost/external-provider-sources/records')
      )
      expect(recordsRes.status).toBe(200)
      const records = (await recordsRes.json()) as Array<{ externalId: string; status: string }>
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ externalId: 'claude:test-anthropic', status: 'active' }),
          expect.objectContaining({ externalId: 'codex:test-openai', status: 'active' })
        ])
      )

      const profilesRes = await app.handle(new Request('http://localhost/profiles'))
      expect(profilesRes.status).toBe(200)
      const profiles = (await profilesRes.json()) as Array<unknown>
      expect(profiles).toEqual([])
      expect(JSON.stringify(records)).not.toContain('test-secret-value')

      const anthropicTargetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/claude:test-anthropic/runtime-target`
        )
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
          credentialRef: expect.stringMatching(/^external_credential_/)
        })
      )

      const disableAnthropicTarget = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/claude:test-anthropic/runtime-target`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: false })
          }
        )
      )
      expect(disableAnthropicTarget.status).toBe(200)
      expect(RuntimeTargetResponseSchema.parse(await disableAnthropicTarget.json())).toEqual(
        expect.objectContaining({
          externalRecordId: 'claude:test-anthropic',
          enabled: false
        })
      )

      const refreshAfterDisable = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST'
        })
      )
      expect(refreshAfterDisable.status).toBe(200)
      const disabledTargetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/claude:test-anthropic/runtime-target`
        )
      )
      expect(disabledTargetRes.status).toBe(200)
      expect(RuntimeTargetResponseSchema.parse(await disabledTargetRes.json())).toEqual(
        expect.objectContaining({
          externalRecordId: 'claude:test-anthropic',
          enabled: false
        })
      )

      const recordsAfterDisableRes = await app.handle(
        new Request('http://localhost/external-provider-sources/records')
      )
      expect(recordsAfterDisableRes.status).toBe(200)
      expect(await recordsAfterDisableRes.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            externalId: 'claude:test-anthropic',
            runtimeTargetEnabled: false
          })
        ])
      )

      const openAiTargetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/codex:test-openai/runtime-target`
        )
      )
      expect(openAiTargetRes.status).toBe(200)
      expect(RuntimeTargetResponseSchema.parse(await openAiTargetRes.json())).toEqual(
        expect.objectContaining({
          sourceKey,
          externalRecordId: 'codex:test-openai',
          providerKind: 'openai-compatible',
          displayName: 'Fixture OpenAI'
        })
      )

      providers = [providers[0]]
      const missingRefresh = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST'
        })
      )
      expect(missingRefresh.status).toBe(200)
      expect(await missingRefresh.json()).toEqual(expect.objectContaining({ recordsMissing: 1 }))

      const missingTargetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/codex:test-openai/runtime-target`
        )
      )
      expect(missingTargetRes.status).toBe(200)
      expect(RuntimeTargetResponseSchema.parse(await missingTargetRes.json())).toEqual(
        expect.objectContaining({
          externalRecordId: 'codex:test-openai',
          enabled: false
        })
      )

      registration.dispose()
    } finally {
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
      externalPluginsDirs: process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
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
                config: { baseUrl: 'https://error.example.test', model: 'gpt-test' }
              }
            ]
          }
        }
      })

      const sources = (await (
        await app.handle(new Request('http://localhost/external-provider-sources'))
      ).json()) as Array<{ id: string }>
      const sourceKey = sources[0].id

      const firstRefresh = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST'
        })
      )
      expect(firstRefresh.status).toBe(200)

      shouldFail = true
      const failedRefresh = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST'
        })
      )
      expect(failedRefresh.status).toBe(200)
      expect(await failedRefresh.json()).toEqual(
        expect.objectContaining({
          status: 'error',
          message: 'fixture source unavailable'
        })
      )

      const profilesRes = await app.handle(new Request('http://localhost/profiles'))
      expect(profilesRes.status).toBe(200)
      expect(await profilesRes.json()).toEqual([])

      const targetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/codex:error-openai/runtime-target`
        )
      )
      expect(targetRes.status).toBe(200)
      expect(RuntimeTargetResponseSchema.parse(await targetRes.json())).toEqual(
        expect.objectContaining({
          externalRecordId: 'codex:error-openai',
          displayName: 'Error Fixture OpenAI',
          enabled: true
        })
      )

      const sourceList = await app.handle(new Request('http://localhost/external-provider-sources'))
      expect(sourceList.status).toBe(200)
      expect(await sourceList.json()).toEqual([
        expect.objectContaining({
          lastSyncStatus: 'error',
          lastSyncError: 'fixture source unavailable'
        })
      ])

      registration.dispose()
    } finally {
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
      externalPluginsDirs: process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
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
          headers: { 'content-type': 'application/json' }
        })
      }

      expect(url).toBe('https://target-openai.example.test/v1/models')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer target-secret-value' })
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-4.1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
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
                  label: 'Target OpenAI'
                }
              }
            ]
          }
        }
      })

      const sources = (await (
        await app.handle(new Request('http://localhost/external-provider-sources'))
      ).json()) as Array<{ id: string }>
      const sourceKey = sources[0].id

      const refresh = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST'
        })
      )
      expect(refresh.status).toBe(200)

      const targetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${sourceKey}/records/codex:target-openai/runtime-target`
        )
      )
      expect(targetRes.status).toBe(200)
      const target = RuntimeTargetResponseSchema.parse(await targetRes.json())

      const healthCheckRes = await app.handle(
        new Request('http://localhost/providers/health-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerKind: 'openai-compatible',
            label: 'ignored',
            config: {},
            secretRef: null,
            providerTargetKind: 'external-record',
            providerTargetId: target.id
          })
        })
      )
      expect(healthCheckRes.status).toBe(200)
      expect(await healthCheckRes.json()).toEqual({
        ok: true,
        label: 'Target OpenAI',
        version: null,
        details: { baseUrl: 'https://target-openai.example.test/v1' },
        errorText: null
      })

      const modelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerKind: 'openai-compatible',
            label: 'ignored',
            config: {},
            secretRef: null,
            providerTargetKind: 'external-record',
            providerTargetId: target.id
          })
        })
      )
      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({ id: 'gpt-4.1-mini', providerKind: 'openai-compatible' }),
        expect.objectContaining({ id: 'gpt-4.1', providerKind: 'openai-compatible' })
      ])

      const visibilityRes = await app.handle(
        new Request(
          `http://localhost/provider-targets/external-record/${target.id}/model-visibility`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabledModels: ['gpt-4.1'] })
          }
        )
      )
      expect(visibilityRes.status).toBe(200)
      const visibilitySettings = ProviderTargetModelSettingsResponseSchema.parse(
        await visibilityRes.json()
      )
      expect(JSON.parse(visibilitySettings.configJson)).toEqual(
        expect.objectContaining({
          baseUrl: 'https://target-openai.example.test/v1',
          model: 'gpt-4.1',
          enabledModels: ['gpt-4.1']
        })
      )

      const customModelsRes = await app.handle(
        new Request(
          `http://localhost/provider-targets/external-record/${target.id}/custom-models`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              models: [
                {
                  id: 'provider-private-model',
                  label: 'Provider Private Model',
                  capabilities: { contextWindow: 64000 }
                }
              ]
            })
          }
        )
      )
      expect(customModelsRes.status).toBe(200)
      expect(await customModelsRes.json()).toEqual([
        expect.objectContaining({ id: 'provider-private-model', label: 'Provider Private Model' })
      ])

      const mappingRes = await app.handle(
        new Request(
          `http://localhost/provider-targets/external-record/${target.id}/model-registry-mappings`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              modelId: 'gpt-4.1-mini',
              model: {
                id: 'gpt-4.1-mini',
                name: 'GPT-4.1 Mini',
                limit: { context: 1047576, output: 32768 },
                modalities: { input: ['text'], output: ['text'] },
                tool_call: true
              }
            })
          }
        )
      )
      expect(mappingRes.status).toBe(200)
      expect(await mappingRes.json()).toEqual([
        expect.objectContaining({ modelId: 'gpt-4.1-mini', registryModelId: 'gpt-4.1-mini' })
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
            providerTargetKind: 'external-record',
            providerTargetId: target.id
          })
        })
      )
      expect(mappedModelsRes.status).toBe(200)
      expect(await mappedModelsRes.json()).toEqual([
        expect.objectContaining({
          id: 'gpt-4.1-mini',
          label: 'GPT-4.1 Mini',
          capabilities: expect.objectContaining({
            registryMatch: 'manual',
            contextWindow: 1047576
          })
        }),
        expect.objectContaining({ id: 'gpt-4.1', providerKind: 'openai-compatible' }),
        expect.objectContaining({ id: 'provider-private-model', label: 'Provider Private Model' })
      ])

      const refreshAfterPreferences = await app.handle(
        new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, {
          method: 'POST'
        })
      )
      expect(refreshAfterPreferences.status).toBe(200)
      const settingsAfterRefreshRes = await app.handle(
        new Request(`http://localhost/provider-targets/external-record/${target.id}/model-settings`)
      )
      expect(settingsAfterRefreshRes.status).toBe(200)
      const settingsAfterRefresh = ProviderTargetModelSettingsResponseSchema.parse(
        await settingsAfterRefreshRes.json()
      )
      expect(JSON.parse(settingsAfterRefresh.configJson)).toEqual(
        expect.objectContaining({
          enabledModels: ['gpt-4.1']
        })
      )
      expect(JSON.parse(settingsAfterRefresh.customModelsJson)).toEqual([
        expect.objectContaining({ id: 'provider-private-model' })
      ])
      expect(JSON.parse(settingsAfterRefresh.modelRegistryMappingsJson)).toEqual([
        expect.objectContaining({ modelId: 'gpt-4.1-mini', registryModelId: 'gpt-4.1-mini' })
      ])

      const providerFetchCount = fetchSpy.mock.calls.filter(
        ([callInput]) => getRequestUrl(callInput) === 'https://target-openai.example.test/v1/models'
      ).length
      expect(providerFetchCount).toBe(2)

      registration.dispose()
    } finally {
      shutdownInfra()
      restoreEnv(previous)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
