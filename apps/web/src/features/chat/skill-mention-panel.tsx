// Output: Composer skill picker rendered from Cradle skill inventory entries.
// Input: `$` trigger query plus locally available or server-searched skill items.
// Position: Feature/chat composer surface for selecting chat-owned skill context parts.

import { PackageIcon } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import type { SkillScope } from '~/lib/types'

import { AutocompletePanel, HighlightedAutocompleteText } from './autocomplete-panel'

export interface SkillMentionItem {
  name: string
  description: string | null
  scope: SkillScope
  skillDir: string
}

type SkillMentionPanelItem = SkillMentionItem & {
  id: string
  searchText: string
}

interface SkillMentionPanelProps {
  items: SkillMentionItem[]
  query: string
  searchItems?: (query: string, signal?: AbortSignal) => Promise<SkillMentionItem[]>
  onSelect: (item: SkillMentionItem) => void
  onClose: () => void
  visible: boolean
}

const MAX_RESULTS = 30

export function SkillMentionPanel({ items, query, searchItems, onSelect, onClose, visible }: SkillMentionPanelProps) {
  const panelItems = useMemo(() => items.map(toSkillMentionPanelItem), [items])
  const searchPanelItems = useCallback(async (searchQuery: string, signal?: AbortSignal) => {
    return searchItems ? (await searchItems(searchQuery, signal)).map(toSkillMentionPanelItem) : []
  }, [searchItems])

  return (
    <AutocompletePanel
      items={panelItems}
      query={query}
      searchItems={searchItems ? searchPanelItems : undefined}
      onSelect={item => onSelect(item)}
      onClose={onClose}
      visible={visible}
      maxResults={MAX_RESULTS}
      emptyLogLabel="skills"
      renderItem={({ item, positions }) => (
        <>
          <PackageIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">
              <HighlightedAutocompleteText text={item.name} positions={positions} />
            </span>
            {item.description && (
              <span className="ml-2 text-muted-foreground">
                {item.description}
              </span>
            )}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatScope(item.scope)}
          </span>
        </>
      )}
    />
  )
}

function toSkillMentionPanelItem(item: SkillMentionItem): SkillMentionPanelItem {
  return {
    ...item,
    id: `${item.scope}:${item.skillDir}`,
    searchText: `${item.name} ${item.description ?? ''}`,
  }
}

function formatScope(scope: SkillScope): string {
  switch (scope) {
    case 'builtin':
      return 'Built-in'
    case 'legacy':
      return 'Agent'
    case 'global':
      return 'Cradle'
    case 'repository':
      return 'Repo'
    case 'workspace':
      return 'Workspace'
    case 'agent':
      return 'Agent'
    default:
      return scope
  }
}
