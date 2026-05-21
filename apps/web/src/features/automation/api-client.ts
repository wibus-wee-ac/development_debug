import { getServerUrl } from '~/lib/electron'

import type { AutomationArtifact, AutomationDefinition, AutomationDefinitionSummary, AutomationRun } from './types'

interface CollectionPayload<T> {
  automations?: T[]
  definitions?: T[]
  runs?: T[]
  artifacts?: T[]
  items?: T[]
  data?: T[]
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getServerUrl()}${path}`, {
    ...init,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Automation request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

function readCollection<T>(payload: T[] | CollectionPayload<T>, keys: Array<keyof CollectionPayload<T>>): T[] {
  if (Array.isArray(payload)) {
    return payload
  }

  for (const key of keys) {
    const value = payload[key]
    if (Array.isArray(value)) {
      return value
    }
  }

  return []
}

async function attachLatestRun(definition: AutomationDefinition): Promise<AutomationDefinitionSummary> {
  try {
    const runs = await listAutomationRuns(definition.id, 1)
    return { ...definition, latestRun: runs[0] ?? null }
  }
  catch {
    return { ...definition, latestRun: null }
  }
}

export async function listAutomationDefinitions(): Promise<AutomationDefinitionSummary[]> {
  const payload = await readJson<AutomationDefinition[] | CollectionPayload<AutomationDefinition>>('/automations')
  const definitions = readCollection(payload, ['automations', 'definitions', 'items', 'data'])
  return Promise.all(definitions.map(attachLatestRun))
}

export async function listAutomationRuns(automationId: string, limit = 20): Promise<AutomationRun[]> {
  const payload = await readJson<AutomationRun[] | CollectionPayload<AutomationRun>>(
    `/automations/${encodeURIComponent(automationId)}/runs`,
  )
  return readCollection(payload, ['runs', 'items', 'data']).slice(0, limit)
}

export async function listAutomationArtifacts(automationId: string): Promise<AutomationArtifact[]> {
  const payload = await readJson<AutomationArtifact[] | CollectionPayload<AutomationArtifact>>(
    `/automations/${encodeURIComponent(automationId)}/artifacts`,
  )
  return readCollection(payload, ['artifacts', 'items', 'data'])
}

export async function runAutomationNow(automationId: string): Promise<AutomationRun> {
  const payload = await readJson<AutomationRun | { run: AutomationRun }>(
    `/automations/${encodeURIComponent(automationId)}/run`,
    { method: 'POST', body: JSON.stringify({}) },
  )

  return 'run' in payload ? payload.run : payload
}
