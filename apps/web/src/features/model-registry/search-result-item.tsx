/**
 * Renders a single search result row with source indicator.
 *
 * Used by both the agent-management models panel and the settings
 * model-registry detail panel to show merged search results from
 * models.dev and the Cradle Model Registry.
 */
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'
import { formatTokenCount } from '~/lib/number-format'

import type { SearchResult, SearchResultSource } from './schemas'

const SOURCE_LABEL: Record<SearchResultSource, string> = {
  'models-dev': 'models.dev',
  'registry': 'Cradle Registry',
}

export function SearchResultItem({
  result,
  source,
  onClick,
  disabled,
}: {
  result: SearchResult
  source: SearchResultSource
  onClick: () => void
  disabled?: boolean
}) {
  const contextWindow = result.capabilities.contextWindow && result.capabilities.contextWindow > 0
    ? formatTokenCount(result.capabilities.contextWindow)
    : null

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
        'hover:bg-accent disabled:opacity-60',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12px] font-medium text-foreground">
            {result.label}
          </span>
          <Badge
            variant="secondary"
            className={cn(
              'shrink-0 text-[9px] font-normal',
              source === 'registry'
                ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
                : 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
            )}
          >
            {SOURCE_LABEL[source]}
          </Badge>
        </div>
        <div className="truncate font-mono text-[10.5px] text-muted-foreground">
          {result.id}
        </div>
      </div>
      {contextWindow && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {contextWindow}
        </span>
      )}
    </button>
  )
}
