// Input: agent identity HTTP endpoints
// Output: integration tests for agent CRUD, filters, and avatar policy
// Position: apps/server/tests

import 'reflect-metadata'

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentProfiles } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'
import { DbAccessor } from '../src/database/db-accessor'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function buildAvatarUrl(style: string, seed: string): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`
}

describe('agent identity capability', () => {
  it('supports CRUD, filters, and avatar URL policy', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()
      const container = app.getContainer()
      const accessor = container.resolve(DbAccessor) as DbAccessor
      const db = accessor.get()

      const profileOneId = randomUUID()
      const profileTwoId = randomUUID()
      db.insert(agentProfiles).values([
        {
          id: profileOneId,
          name: 'Profile One',
          providerKind: 'openai-compatible',
        },
        {
          id: profileTwoId,
          name: 'Profile Two',
          providerKind: 'codex',
        },
      ]).run()

      const createOne = await hono.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Agent One',
          description: 'First agent',
          avatarStyle: 'bottts-neutral',
          avatarSeed: 'seed-one',
          agentProfileId: profileOneId,
          modelId: 'gpt-test',
          thinkingEffort: 'high',
          configJson: '{"systemPrompt":"hello"}',
        }),
      })
      expect(createOne.status).toBe(200)
      const agentOne = await createOne.json()
      expect(agentOne).toEqual(expect.objectContaining({
        name: 'Agent One',
        description: 'First agent',
        agentProfileId: profileOneId,
        modelId: 'gpt-test',
        thinkingEffort: 'high',
        enabled: true,
      }))
      expect(agentOne.avatarUrl).toBe(buildAvatarUrl('bottts-neutral', 'seed-one'))

      const createTwo = await hono.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Agent Two',
          avatarStyle: 'identicon',
          avatarSeed: 'seed-two',
          agentProfileId: profileTwoId,
        }),
      })
      expect(createTwo.status).toBe(200)
      const agentTwo = await createTwo.json()
      expect(agentTwo.avatarUrl).toBe(buildAvatarUrl('identicon', 'seed-two'))
      expect(agentTwo.enabled).toBe(true)

      const listRes = await hono.request('/agents')
      expect(listRes.status).toBe(200)
      const list = await listRes.json()
      expect(list).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: agentOne.id }),
        expect.objectContaining({ id: agentTwo.id }),
      ]))

      const getRes = await hono.request(`/agents/${agentOne.id}`)
      expect(getRes.status).toBe(200)
      expect(await getRes.json()).toEqual(expect.objectContaining({ id: agentOne.id }))

      const missingGet = await hono.request('/agents/missing-agent')
      expect(missingGet.status).toBe(200)
      expect(await missingGet.json()).toBeNull()

      const updateRes = await hono.request(`/agents/${agentTwo.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description: 'Updated agent',
          avatarSeed: 'seed-two-next',
          enabled: false,
          modelId: 'codex-next',
          thinkingEffort: 'medium',
        }),
      })
      expect(updateRes.status).toBe(200)
      const updated = await updateRes.json()
      expect(updated).toEqual(expect.objectContaining({
        id: agentTwo.id,
        description: 'Updated agent',
        enabled: false,
        modelId: 'codex-next',
        thinkingEffort: 'medium',
      }))
      expect(updated.avatarStyle).toBe('identicon')
      expect(updated.avatarSeed).toBe('seed-two-next')
      expect(updated.avatarUrl).toBe(buildAvatarUrl('identicon', 'seed-two-next'))

      const enabledRes = await hono.request('/agents?enabled=true')
      expect(enabledRes.status).toBe(200)
      expect(await enabledRes.json()).toEqual([
        expect.objectContaining({ id: agentOne.id, enabled: true }),
      ])

      const disabledRes = await hono.request('/agents?enabled=false')
      expect(disabledRes.status).toBe(200)
      expect(await disabledRes.json()).toEqual([
        expect.objectContaining({ id: agentTwo.id, enabled: false }),
      ])

      const profileFiltered = await hono.request(`/agents?agentProfileId=${encodeURIComponent(profileTwoId)}`)
      expect(profileFiltered.status).toBe(200)
      expect(await profileFiltered.json()).toEqual([
        expect.objectContaining({ id: agentTwo.id, agentProfileId: profileTwoId }),
      ])

      const invalidCreate = await hono.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: '',
          avatarStyle: '',
          avatarSeed: '',
          agentProfileId: '',
        }),
      })
      expect(invalidCreate.status).toBe(400)
      const invalidCreateBody = await invalidCreate.json()
      expect(invalidCreateBody.code).toBe('invalid_agent_input')

      const invalidProvider = await hono.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Broken Agent',
          avatarStyle: 'thumbs',
          avatarSeed: 'broken-seed',
          agentProfileId: randomUUID(),
        }),
      })
      expect(invalidProvider.status).toBe(400)
      const invalidProviderBody = await invalidProvider.json()
      expect(invalidProviderBody.code).toBe('agent_profile_not_found')

      const missingUpdate = await hono.request('/agents/missing-agent', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Missing Agent' }),
      })
      expect(missingUpdate.status).toBe(200)
      expect(await missingUpdate.json()).toBeNull()

      const deleteRes = await hono.request(`/agents/${agentOne.id}`, { method: 'DELETE' })
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ ok: true })

      const afterDelete = await hono.request(`/agents/${agentOne.id}`)
      expect(afterDelete.status).toBe(200)
      expect(await afterDelete.json()).toBeNull()
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
    }
  })
})
