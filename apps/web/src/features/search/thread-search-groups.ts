import type { ThreadSearchHit } from '~/lib/types'

export interface GroupedSearchHits {
  value: string
  label: string
  items: ThreadSearchHit[]
}

export function groupHitsByWorkspace(hits: ThreadSearchHit[]): GroupedSearchHits[] {
  const groupsByWorkspace = new Map<string, GroupedSearchHits>()

  for (const hit of hits) {
    const existingGroup = groupsByWorkspace.get(hit.workspaceId)
    if (existingGroup) {
      existingGroup.items.push(hit)
      continue
    }

    groupsByWorkspace.set(hit.workspaceId, {
      value: hit.workspaceId,
      label: hit.workspaceName ?? 'Untitled workspace',
      items: [hit],
    })
  }

  return [...groupsByWorkspace.values()]
}
