import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ExternalProviderRecord } from '@cradle/plugin-sdk/server'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'
import { registerExternalProviderSource } from '../src/plugins/external-provider-source-registry'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
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
  it('projects plugin provider snapshots into read-only profiles without exposing secrets', async () => {
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

    let providers: ExternalProviderRecord[] = [
      {
        externalId: 'claude:test-anthropic',
        app: 'claude',
        name: 'Fixture Anthropic',
        providerKind: 'anthropic',
        config: { baseUrl: 'https://anthropic.example.test', model: 'claude-test' },
        credential: { kind: 'api-key', value: 'test-secret-value', label: 'Fixture Anthropic' },
        metadata: { baseUrl: 'https://anthropic.example.test', model: 'claude-test', health: 'unknown' },
      },
      {
        externalId: 'codex:test-openai',
        app: 'codex',
        name: 'Fixture OpenAI',
        providerKind: 'openai-compatible',
        config: { baseUrl: 'https://openai.example.test', model: 'gpt-test', apiMode: 'responses' },
        credential: { kind: 'api-key', value: 'test-secret-value', label: 'Fixture OpenAI' },
        metadata: { baseUrl: 'https://openai.example.test', model: 'gpt-test', apiFormat: 'openai_responses' },
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

      const sourcesBeforeRefresh = await app.handle(new Request('http://localhost/external-provider-sources'))
      expect(sourcesBeforeRefresh.status).toBe(200)
      const sourceList = await sourcesBeforeRefresh.json() as Array<{ id: string, label: string, lastSyncStatus: string }>
      expect(sourceList).toEqual([
        expect.objectContaining({
          label: 'Fixture Providers',
          lastSyncStatus: 'never',
        }),
      ])
      const sourceKey = sourceList[0].id

      const refresh = await app.handle(new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, { method: 'POST' }))
      expect(refresh.status).toBe(200)
      expect(await refresh.json()).toEqual(expect.objectContaining({
        sourceKey,
        status: 'ok',
        recordsSeen: 2,
        recordsProjected: 2,
        recordsMissing: 0,
      }))

      const recordsRes = await app.handle(new Request('http://localhost/external-provider-sources/records'))
      expect(recordsRes.status).toBe(200)
      const records = await recordsRes.json() as Array<{ externalId: string, status: string }>
      expect(records).toEqual(expect.arrayContaining([
        expect.objectContaining({ externalId: 'claude:test-anthropic', status: 'active' }),
        expect.objectContaining({ externalId: 'codex:test-openai', status: 'active' }),
      ]))

      const profilesRes = await app.handle(new Request('http://localhost/profiles'))
      expect(profilesRes.status).toBe(200)
      const profiles = await profilesRes.json() as Array<{ id: string, name: string, configJson: string, credentialRef: string | null, enabled: boolean }>
      const anthropicProfile = profiles.find(profile => profile.name === 'Fixture Anthropic')
      const openAiProfile = profiles.find(profile => profile.name === 'Fixture OpenAI')
      expect(anthropicProfile).toBeTruthy()
      expect(openAiProfile).toBeTruthy()
      expect(JSON.stringify(profiles)).not.toContain('test-secret-value')
      expect(anthropicProfile?.credentialRef).toMatch(/^external_credential_/)

      const profileLinkRes = await app.handle(new Request(`http://localhost/profiles/${anthropicProfile!.id}/external-source`))
      expect(profileLinkRes.status).toBe(200)
      expect(await profileLinkRes.json()).toEqual(expect.objectContaining({
        sourceKey,
        externalRecordId: 'claude:test-anthropic',
        profileId: anthropicProfile!.id,
        credentialRef: anthropicProfile!.credentialRef,
      }))

      const editMirroredProfile = await app.handle(new Request(`http://localhost/profiles/${anthropicProfile!.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Edited',
          providerKind: 'anthropic',
          enabled: true,
          config: { baseUrl: 'https://changed.example.test' },
          credentialRef: anthropicProfile!.credentialRef,
        }),
      }))
      expect(editMirroredProfile.status).toBe(409)
      expect((await editMirroredProfile.json()).code).toBe('profile_managed_by_external_source')

      providers = [providers[0]]
      const missingRefresh = await app.handle(new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, { method: 'POST' }))
      expect(missingRefresh.status).toBe(200)
      expect(await missingRefresh.json()).toEqual(expect.objectContaining({ recordsMissing: 1 }))

      const profileAfterMissingRes = await app.handle(new Request(`http://localhost/profiles/${openAiProfile!.id}`))
      expect(profileAfterMissingRes.status).toBe(200)
      expect(await profileAfterMissingRes.json()).toEqual(expect.objectContaining({ enabled: false }))

      registration.dispose()
    }
    finally {
      shutdownInfra()
      restoreEnv(previous)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('records source errors without deleting previous projections', async () => {
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

      const sources = await (await app.handle(new Request('http://localhost/external-provider-sources'))).json() as Array<{ id: string }>
      const sourceKey = sources[0].id

      const firstRefresh = await app.handle(new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, { method: 'POST' }))
      expect(firstRefresh.status).toBe(200)

      shouldFail = true
      const failedRefresh = await app.handle(new Request(`http://localhost/external-provider-sources/${sourceKey}/refresh`, { method: 'POST' }))
      expect(failedRefresh.status).toBe(200)
      expect(await failedRefresh.json()).toEqual(expect.objectContaining({
        status: 'error',
        message: 'fixture source unavailable',
      }))

      const profilesRes = await app.handle(new Request('http://localhost/profiles'))
      expect(profilesRes.status).toBe(200)
      expect(await profilesRes.json()).toEqual([
        expect.objectContaining({ name: 'Error Fixture OpenAI', enabled: true }),
      ])

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
})
