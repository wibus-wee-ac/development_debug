// Input: profiles, secrets, and providers HTTP endpoints
// Output: integration tests for profile CRUD, provider metadata, and secret masking
// Position: apps/server/tests

import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('profiles capability', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('supports secret masking, profile CRUD, health checks, and model listing', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-profiles'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      expect(url).toBe('https://example.com/v1/models')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk-test-abcdef' })
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()

      const saveSecret = await hono.request('/secrets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          label: 'Primary OpenAI Key',
          secret: 'sk-test-abcdef',
        }),
      })
      expect(saveSecret.status).toBe(200)
      const secret = await saveSecret.json()
      expect(secret.maskedSecret).toBe('sk-...cdef')

      const createProfile = await hono.request('/profiles/profile-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Primary Profile',
          providerKind: 'openai-compatible',
          enabled: true,
          config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o' },
          credentialRef: secret.id,
        }),
      })
      expect(createProfile.status).toBe(200)
      const profile = await createProfile.json()
      expect(profile).toEqual(expect.objectContaining({
        id: 'profile-1',
        name: 'Primary Profile',
        providerKind: 'openai-compatible',
        credentialRef: secret.id,
      }))

      const listProfiles = await hono.request('/profiles')
      expect(listProfiles.status).toBe(200)
      expect(await listProfiles.json()).toEqual([
        expect.objectContaining({ id: 'profile-1' }),
      ])

      const getProfile = await hono.request('/profiles/profile-1')
      expect(getProfile.status).toBe(200)
      expect(await getProfile.json()).toEqual(expect.objectContaining({ id: 'profile-1' }))

      const healthCheckRes = await hono.request('/providers/health-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-1',
          providerKind: 'openai-compatible',
          label: 'Primary Profile',
          config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o' },
          secretRef: secret.id,
        }),
      })
      expect(healthCheckRes.status).toBe(200)
      expect(await healthCheckRes.json()).toEqual({
        ok: true,
        label: 'Primary Profile',
        version: null,
        details: { baseUrl: 'https://example.com/v1' },
        errorText: null,
      })

      const modelsRes = await hono.request('/providers/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-1',
          providerKind: 'openai-compatible',
          label: 'Primary Profile',
          config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o' },
          secretRef: secret.id,
        }),
      })
      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({ id: 'gpt-4o-mini', providerKind: 'openai-compatible' }),
        expect.objectContaining({ id: 'gpt-4o', providerKind: 'openai-compatible' }),
      ])
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      const listSecrets = await hono.request('/secrets')
      expect(listSecrets.status).toBe(200)
      const secrets = await listSecrets.json()
      expect(secrets).toEqual([
        expect.objectContaining({ id: secret.id, maskedSecret: 'sk-...cdef' }),
      ])
      expect(JSON.stringify(secrets)).not.toContain('sk-test-abcdef')

      const deleteProfile = await hono.request('/profiles/profile-1', { method: 'DELETE' })
      expect(deleteProfile.status).toBe(200)
      expect(await deleteProfile.json()).toEqual({ ok: true })

      const afterDelete = await hono.request('/profiles/profile-1')
      expect(afterDelete.status).toBe(200)
      expect(await afterDelete.json()).toBeNull()

      const removeSecret = await hono.request(`/secrets/${secret.id}`, {
        method: 'DELETE',
      })
      expect(removeSecret.status).toBe(200)
      expect(await removeSecret.json()).toEqual({ ok: true })
    }
    finally {
      if (app) {
        await app.close()
      }
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
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

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()

      const invalidProfile = await hono.request('/profiles/profile-bad', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerKind: 'openai-compatible' }),
      })
      expect(invalidProfile.status).toBe(400)
      expect((await invalidProfile.json()).code).toBe('invalid_profile_input')

      const saveSecret = await hono.request('/secrets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          label: 'Missing Secret Config',
          secret: 'sk-test-abcdef',
        }),
      })
      expect(saveSecret.status).toBe(500)
      expect((await saveSecret.json()).code).toBe('secret_not_configured')

      process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-profiles'

      const unsupportedProfile = await hono.request('/profiles/profile-unsupported', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Unsupported Profile',
          providerKind: 'cli-tui',
          enabled: true,
          config: {},
        }),
      })
      expect(unsupportedProfile.status).toBe(200)

      const invalidProviderBody = await hono.request('/providers/health-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerKind: 'openai-compatible' }),
      })
      expect(invalidProviderBody.status).toBe(400)
      expect((await invalidProviderBody.json()).code).toBe('invalid_provider_input')

      const unavailableProvider = await hono.request('/providers/health-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-unsupported',
          providerKind: 'cli-tui',
          label: 'Unsupported Profile',
          config: {},
          secretRef: null,
        }),
      })
      expect(unavailableProvider.status).toBe(501)
      expect((await unavailableProvider.json()).code).toBe('provider_not_available')
    }
    finally {
      if (app) {
        await app.close()
      }
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })
})
