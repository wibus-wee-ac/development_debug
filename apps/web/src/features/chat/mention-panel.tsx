import { FolderIcon } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { WorkspaceFileIcon, WorkspaceFileIconSpriteSheet } from '~/components/common/workspace-file-icon'

import { AutocompletePanel, HighlightedAutocompleteText } from './autocomplete-panel'

export interface MentionItem {
  type: 'file' | 'directory'
  name: string
  /** Relative path from workspace root */
  path: string
}

type MentionPanelItem = MentionItem & {
  id: string
  searchText: string
}

interface MentionPanelProps {
  items: MentionItem[]
  query: string
  searchItems?: (query: string, signal?: AbortSignal) => Promise<MentionItem[]>
  onSelect: (item: MentionItem) => void
  onTabComplete?: (item: MentionItem) => void
  onClose: () => void
  visible: boolean
}

const MAX_RESULTS = 30

export function MentionPanel({ items, query, searchItems, onSelect, onTabComplete, onClose, visible }: MentionPanelProps) {
  const panelItems = useMemo(() => items.map(toMentionPanelItem), [items])
  const searchPanelItems = useCallback(async (searchQuery: string, signal?: AbortSignal) => {
    return searchItems ? (await searchItems(searchQuery, signal)).map(toMentionPanelItem) : []
  }, [searchItems])

  return (
    <>
      <WorkspaceFileIconSpriteSheet />
      <AutocompletePanel
        items={panelItems}
        query={query}
        searchItems={searchItems ? searchPanelItems : undefined}
        onSelect={item => onSelect(toMentionItem(item))}
        onTabComplete={onTabComplete ? item => onTabComplete(toMentionItem(item)) : undefined}
        onClose={onClose}
        visible={visible}
        maxResults={MAX_RESULTS}
        emptyLogLabel="workspace files"
        rankFields={item => [
          { value: item.name, role: 'primary' },
          { value: item.path, role: 'path' },
        ]}
        renderItem={({ item, positions }) => (
          <>
            {item.type === 'directory'
              ? <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              : <WorkspaceFileIcon path={item.path} className="size-3.5 text-muted-foreground/60" />}
            <span className="min-w-0 truncate">
              <HighlightedAutocompleteText text={item.path} positions={positions} />
            </span>
          </>
        )}
      />
    </>
  )
}

function toMentionPanelItem(item: MentionItem): MentionPanelItem {
  return {
    ...item,
    id: item.path,
    searchText: item.path,
  }
}

function toMentionItem(item: MentionPanelItem): MentionItem {
  return {
    type: item.type,
    name: item.name,
    path: item.path,
  }
}
