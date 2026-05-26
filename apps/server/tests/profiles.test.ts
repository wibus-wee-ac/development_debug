import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agents, sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const ProfileResponseSchema = z.object({
  configJson: z.string(),
  customModels: z.string()
})
const ProviderTargetModelSettingsResponseSchema = z.object({
  modelRegistryMappingsJson: z.string()
})

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function getRequestUrl(input: Parameters<typeof fetch>[0]): string {
  return new Request(input).url
}

describe('profiles capability', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('supports secret masking, profile CRUD, and model listing', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-profiles'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getRequestUrl(input)
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      expect(url).toBe('https://example.com/v1/models')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk-test-abcdef' })
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const saveSecret = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'openai-compatible',
            label: 'Primary OpenAI Key',
            secret: 'sk-test-abcdef'
          })
        })
      )
      expect(saveSecret.status).toBe(200)
      const secret = await saveSecret.json()
      expect(secret.maskedSecret).toBe('sk-...cdef')

      const createProfile = await app.handle(
        new Request('http://localhost/profiles/profile-1', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Primary Profile',
            providerKind: 'openai-compatible',
            enabled: true,
            config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o' },
            credentialRef: secret.id
          })
        })
      )
      expect(createProfile.status).toBe(200)
      const profile = await createProfile.json()
      expect(profile).toEqual(
        expect.objectContaining({
          id: 'profile-1',
          name: 'Primary Profile',
          providerKind: 'openai-compatible',
          credentialRef: secret.id
        })
      )

      const listProfiles = await app.handle(new Request('http://localhost/profiles'))
      expect(listProfiles.status).toBe(200)
      expect(await listProfiles.json()).toEqual([expect.objectContaining({ id: 'profile-1' })])

      const getProfile = await app.handle(new Request('http://localhost/profiles/profile-1'))
      expect(getProfile.status).toBe(200)
      expect(await getProfile.json()).toEqual(expect.objectContaining({ id: 'profile-1' }))

      const modelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            profileId: 'profile-1',
            providerKind: 'openai-compatible',
            label: 'Primary Profile',
            config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o' },
            secretRef: secret.id
          })
        })
      )
      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({ id: 'gpt-4o-mini', providerKind: 'openai-compatible' }),
        expect.objectContaining({ id: 'gpt-4o', providerKind: 'openai-compatible' })
      ])
      const providerFetchCount = fetchSpy.mock.calls.filter(
        ([callInput]) => getRequestUrl(callInput) === 'https://example.com/v1/models'
      ).length
      expect(providerFetchCount).toBe(1)

      const listSecrets = await app.handle(new Request('http://localhost/secrets'))
      expect(listSecrets.status).toBe(200)
      const secrets = await listSecrets.json()
      expect(secrets).toEqual([
        expect.objectContaining({ id: secret.id, maskedSecret: 'sk-...cdef' })
      ])
      expect(JSON.stringify(secrets)).not.toContain('sk-test-abcdef')

      const deleteProfile = await app.handle(
        new Request('http://localhost/profiles/profile-1', { method: 'DELETE' })
      )
      expect(deleteProfile.status).toBe(200)
      expect(await deleteProfile.json()).toEqual({ ok: true })

      const afterDelete = await app.handle(new Request('http://localhost/profiles/profile-1'))
      expect(afterDelete.status).toBe(404)

      const removeSecret = await app.handle(
        new Request(`http://localhost/secrets/${secret.id}`, {
          method: 'DELETE'
        })
      )
      expect(removeSecret.status).toBe(200)
      expect(await removeSecret.json()).toEqual({ ok: true })
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('deletes profile-owned agents even when older sessions reference the agent only', async () => {
    const dataDir = makeTempDir('cradle-profile-delete-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-profile-delete'

    try {
      const app = await createServerApp()
      const createProfile = await app.handle(
        new Request('http://localhost/profiles/profile-cleanup', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Cleanup Profile',
            providerKind: 'openai-compatible',
            enabled: true,
            config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o' },
            credentialRef: null
          })
        })
      )
      expect(createProfile.status).toBe(200)

      db()
        .insert(agents)
        .values({
          id: 'agent-cleanup',
          name: 'Cleanup Agent',
          description: null,
          avatarUrl: null,
          avatarStyle: 'bottts-neutral',
          avatarSeed: 'cleanup',
          agentProfileId: 'profile-cleanup',
          providerTargetKind: 'manual-profile',
          providerTargetId: 'profile-cleanup',
          runtimeKind: 'standard',
          configJson: '{}',
          enabled: true
        })
        .run()
      db()
        .insert(sessions)
        .values({
          id: 'session-agent-only-cleanup',
          workspaceId: null,
          title: 'Legacy Agent Session',
          agentProfileId: null,
          providerTargetKind: 'manual-profile',
          providerTargetId: 'profile-cleanup',
          runtimeKind: 'standard',
          agentId: 'agent-cleanup',
          configJson: '{}'
        })
        .run()

      const deleteProfile = await app.handle(
        new Request('http://localhost/profiles/profile-cleanup', { method: 'DELETE' })
      )
      expect(deleteProfile.status).toBe(200)
      expect(db().select().from(agents).where(eq(agents.id, 'agent-cleanup')).all()).toEqual([])
      expect(
        db().select().from(sessions).where(eq(sessions.id, 'session-agent-only-cleanup')).all()
      ).toEqual([])
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('returns structured errors for invalid input, missing profile, unavailable provider, and missing secret config', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_CREDENTIAL_SECRET

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const invalidProfile = await app.handle(
        new Request('http://localhost/profiles/profile-bad', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providerKind: 'openai-compatible' })
        })
      )
      expect(invalidProfile.status).toBe(400)
      expect((await invalidProfile.json()).code).toBe('validation_error')

      const saveSecret = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'openai-compatible',
            label: 'Missing Secret Config',
            secret: 'sk-test-abcdef'
          })
        })
      )
      expect(saveSecret.status).toBe(500)
      expect((await saveSecret.json()).code).toBe('secret_not_configured')

      process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-profiles'

      const invalidProviderKind = await app.handle(
        new Request('http://localhost/profiles/profile-unsupported', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Unsupported Profile',
            providerKind: 'cli-tui',
            enabled: true,
            config: {}
          })
        })
      )
      expect(invalidProviderKind.status).toBe(400)

      const invalidProviderBody = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providerKind: 'openai-compatible' })
        })
      )
      expect(invalidProviderBody.status).toBe(400)
      expect((await invalidProviderBody.json()).code).toBe('validation_error')

      const unavailableProvider = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerKind: 'not-a-real-provider',
            label: 'Unsupported Profile',
            config: {},
            secretRef: null
          })
        })
      )
      expect(unavailableProvider.status).toBe(400)
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('stores Available Model registry mappings separately from custom models', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-model-mapping'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getRequestUrl(input)
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      expect(url).toBe('https://example.com/v1/models')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk-map-test' })
      return new Response(JSON.stringify({ data: [{ id: 'vendor-gpt4o' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const secretRes = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'openai-compatible',
            label: 'Mapped Key',
            secret: 'sk-map-test'
          })
        })
      )
      expect(secretRes.status).toBe(200)
      const secret = (await secretRes.json()) as { id: string }

      const profileRes = await app.handle(
        new Request('http://localhost/profiles/profile-map', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Mapped Profile',
            providerKind: 'openai-compatible',
            enabled: true,
            config: { baseUrl: 'https://example.com/v1' },
            credentialRef: secret.id
          })
        })
      )
      expect(profileRes.status).toBe(200)

      const firstModelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            profileId: 'profile-map',
            providerKind: 'openai-compatible',
            label: 'Mapped Profile',
            config: { baseUrl: 'https://example.com/v1' },
            secretRef: secret.id
          })
        })
      )
      expect(firstModelsRes.status).toBe(200)
      expect(await firstModelsRes.json()).toEqual([
        expect.objectContaining({
          id: 'vendor-gpt4o',
          capabilities: expect.objectContaining({ registryMatch: 'unmatched' })
        })
      ])

      const mappingRes = await app.handle(
        new Request('http://localhost/profiles/profile-map/model-registry-mappings', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            modelId: 'vendor-gpt4o',
            model: {
              id: 'gpt-4o',
              name: 'GPT-4o',
              limit: { context: 128000, output: 16384 },
              modalities: { input: ['text', 'image'], output: ['text'] },
              reasoning: false,
              tool_call: true
            }
          })
        })
      )
      expect(mappingRes.status).toBe(200)
      expect(await mappingRes.json()).toEqual([
        expect.objectContaining({
          modelId: 'vendor-gpt4o',
          registryModelId: 'gpt-4o',
          model: expect.objectContaining({ id: 'gpt-4o', name: 'GPT-4o' })
        })
      ])

      const profileAfterMappingRes = await app.handle(
        new Request('http://localhost/profiles/profile-map')
      )
      expect(profileAfterMappingRes.status).toBe(200)
      const profileAfterMapping = ProfileResponseSchema.parse(await profileAfterMappingRes.json())
      expect(profileAfterMapping.customModels).toBe('[]')
      const settingsAfterMappingRes = await app.handle(
        new Request('http://localhost/provider-targets/profile-map/model-settings')
      )
      expect(settingsAfterMappingRes.status).toBe(200)
      const settingsAfterMapping = ProviderTargetModelSettingsResponseSchema.parse(
        await settingsAfterMappingRes.json()
      )
      expect(JSON.parse(settingsAfterMapping.modelRegistryMappingsJson)).toEqual([
        expect.objectContaining({ modelId: 'vendor-gpt4o', registryModelId: 'gpt-4o' })
      ])

      const mappedModelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            profileId: 'profile-map',
            providerKind: 'openai-compatible',
            label: 'Mapped Profile',
            config: { baseUrl: 'https://example.com/v1' },
            secretRef: secret.id
          })
        })
      )
      expect(mappedModelsRes.status).toBe(200)
      expect(await mappedModelsRes.json()).toEqual([
        expect.objectContaining({
          id: 'vendor-gpt4o',
          label: 'GPT-4o',
          capabilities: expect.objectContaining({
            registryMatch: 'manual',
            registryModelId: 'gpt-4o',
            registryModelLabel: 'GPT-4o',
            contextWindow: 128000,
            maxOutput: 16384,
            toolCall: true
          })
        })
      ])

      const providerFetchCount = fetchSpy.mock.calls.filter(
        ([callInput]) => getRequestUrl(callInput) === 'https://example.com/v1/models'
      ).length
      expect(providerFetchCount).toBe(2)
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('lists Anthropic models with the official default base URL and x-api-key auth', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-anthropic'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getRequestUrl(input)
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      expect(url).toBe('https://api.anthropic.com/v1/models')
      expect(init?.headers).toMatchObject({ 'x-api-key': 'sk-ant-test' })
      return new Response(
        JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const saveSecret = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'anthropic',
            label: 'Anthropic Key',
            secret: 'sk-ant-test'
          })
        })
      )
      expect(saveSecret.status).toBe(200)
      const secret = (await saveSecret.json()) as { id: string }

      const modelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerKind: 'anthropic',
            label: 'Anthropic',
            config: {},
            secretRef: secret.id
          })
        })
      )

      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({
          id: 'claude-sonnet-4-20250514',
          label: 'Claude Sonnet 4',
          providerKind: 'anthropic',
          capabilities: expect.objectContaining({
            inputModalities: ['text', 'image'],
            outputModalities: ['text']
          })
        })
      ])
      const providerFetchCount = fetchSpy.mock.calls.filter(
        ([callInput]) => getRequestUrl(callInput) === 'https://api.anthropic.com/v1/models'
      ).length
      expect(providerFetchCount).toBe(1)
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('lists Anthropic models from a root base URL by probing /v1/models first', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-root-anthropic'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getRequestUrl(input)
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      expect(url).toBe('https://api.zhengmi.org/v1/models')
      expect(init?.headers).toMatchObject({
        'anthropic-version': '2023-06-01',
        'x-api-key': 'sk-ant-root'
      })
      return new Response(
        JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const saveSecret = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'anthropic',
            label: 'Root Anthropic Key',
            secret: 'sk-ant-root'
          })
        })
      )
      expect(saveSecret.status).toBe(200)
      const secret = (await saveSecret.json()) as { id: string }

      const modelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerKind: 'anthropic',
            label: 'Root Anthropic',
            config: { baseUrl: 'https://api.zhengmi.org' },
            secretRef: secret.id
          })
        })
      )

      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({
          id: 'claude-sonnet-4-20250514',
          label: 'Claude Sonnet 4',
          providerKind: 'anthropic'
        })
      ])
      const providerFetchCount = fetchSpy.mock.calls.filter(
        ([callInput]) => getRequestUrl(callInput) === 'https://api.zhengmi.org/v1/models'
      ).length
      expect(providerFetchCount).toBe(1)
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })
})
