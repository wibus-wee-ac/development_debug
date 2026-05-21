import {
  ColumnsIcon,
  FilterIcon,
  GroupIcon,
  ListIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  SortAscIcon,
} from 'lucide-react'

import { Checkbox } from '~/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/cn'

import type { FilterState, ViewConfig } from './use-view-config'

interface ToolbarProps {
  config: ViewConfig
  setConfig: (patch: Partial<ViewConfig>) => void
  filter: FilterState
  setFilter: (patch: Partial<FilterState>) => void
  resetFilter: () => void
  searchQuery: string
  onSearchChange: (q: string) => void
  onCreateIssue?: () => void
}

function ToolbarPill({ children, active, className, ...props }: {
  children: React.ReactNode
  active?: boolean
  className?: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-center size-8 rounded-full border border-border shadow-sm',
        'transition-[background-color,transform] duration-150 ease-out',
        'hover:bg-muted active:scale-[0.95]',
        active && 'bg-muted',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function KanbanToolbar({
  config,
  setConfig,
  filter,
  setFilter,
  resetFilter,
  searchQuery: _searchQuery,
  onSearchChange: _onSearchChange,
  onCreateIssue,
}: ToolbarProps) {
  const hasFilter = !!(
    filter.statusIds?.length
    || filter.priorities?.length
    || filter.labels?.length
    || filter.milestoneId
    || filter.isDelegated != null
  )

  return (
    <div className="relative flex items-center gap-1 px-4 py-2">
      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <FilterPopover filter={filter} setFilter={setFilter} resetFilter={resetFilter} hasFilter={hasFilter} />

        <GroupByDropdown config={config} setConfig={setConfig} />

        <SortDropdown config={config} setConfig={setConfig} />

        <DisplayPopover config={config} setConfig={setConfig} />

        {onCreateIssue && (
          <ToolbarPill onClick={onCreateIssue} data-testid="kanban-create-issue-btn" aria-label="Create issue">
            <PlusIcon className="size-3.5" aria-hidden="true" />
          </ToolbarPill>
        )}

        <div className="flex items-center gap-0.5 ml-1 rounded-full border border-border p-0.5">
          <button
            onClick={() => setConfig({ layout: 'board' })}
            aria-label="Board layout"
            aria-pressed={config.layout === 'board'}
            className={cn(
              'flex items-center justify-center size-7 rounded-full transition-colors duration-100',
              config.layout === 'board' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ColumnsIcon className="size-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={() => setConfig({ layout: 'list' })}
            aria-label="List layout"
            aria-pressed={config.layout === 'list'}
            className={cn(
              'flex items-center justify-center size-7 rounded-full transition-colors duration-100',
              config.layout === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ListIcon className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

function FilterPopover({ filter, setFilter, resetFilter, hasFilter }: {
  filter: FilterState
  setFilter: (patch: Partial<FilterState>) => void
  resetFilter: () => void
  hasFilter: boolean
}) {
  const priorities = ['urgent', 'high', 'medium', 'low', 'none'] as const
  const selectedPriorities = filter.priorities ?? []

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarPill active={hasFilter} data-testid="kanban-filter-btn" aria-label="Filter issues">
          <FilterIcon className="size-3.5" aria-hidden="true" />
        </ToolbarPill>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <div className="p-3 space-y-3">
          <div>
            <p className="text-[12px] font-medium text-muted-foreground mb-1.5">优先级</p>
            <div className="space-y-1">
              {priorities.map(p => (
                <label
                  key={p}
                  htmlFor={`kanban-filter-priority-${p}`}
                  className="flex items-center gap-2 text-[13px] cursor-pointer"
                >
                  <Checkbox
                    id={`kanban-filter-priority-${p}`}
                    checked={selectedPriorities.includes(p)}
                    onCheckedChange={(checked) => {
                      const next = checked
                        ? [...selectedPriorities, p]
                        : selectedPriorities.filter(x => x !== p)
                      setFilter({ priorities: next.length ? next : undefined })
                    }}
                  />
                  <span className="capitalize">{p === 'none' ? '无' : p}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="kanban-filter-delegated" className="flex items-center gap-2 text-[13px] cursor-pointer">
              <Checkbox
                id="kanban-filter-delegated"
                checked={filter.isDelegated === true}
                onCheckedChange={(checked) => {
                  setFilter({ isDelegated: checked ? true : null })
                }}
              />
              仅委派给 Agent
            </label>
          </div>
          {hasFilter && (
            <button onClick={resetFilter} className="text-[12px] text-muted-foreground hover:text-foreground">
              清除筛选
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function GroupByDropdown({ config, setConfig }: { config: ViewConfig, setConfig: (p: Partial<ViewConfig>) => void }) {
  const options = [
    { value: 'status', label: '状态' },
    { value: 'priority', label: '优先级' },
    { value: 'milestone', label: '里程碑' },
    { value: 'assignee', label: '负责人' },
    { value: 'label', label: '标签' },
  ] as const

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarPill data-testid="kanban-group-btn" aria-label="Group issues">
          <GroupIcon className="size-3.5" aria-hidden="true" />
        </ToolbarPill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup value={config.groupBy} onValueChange={v => setConfig({ groupBy: v as ViewConfig['groupBy'] })}>
          {options.map(opt => (
            <DropdownMenuRadioItem key={opt.value} value={opt.value}>
              {opt.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SortDropdown({ config, setConfig }: { config: ViewConfig, setConfig: (p: Partial<ViewConfig>) => void }) {
  const options = [
    { value: 'manual', label: '手动' },
    { value: 'priority', label: '优先级' },
    { value: 'created', label: '创建时间' },
    { value: 'updated', label: '更新时间' },
    { value: 'status', label: '状态' },
  ] as const

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarPill data-testid="kanban-sort-btn" aria-label="Sort issues">
          <SortAscIcon className="size-3.5" aria-hidden="true" />
        </ToolbarPill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup value={config.orderBy} onValueChange={v => setConfig({ orderBy: v as ViewConfig['orderBy'] })}>
          {options.map(opt => (
            <DropdownMenuRadioItem key={opt.value} value={opt.value}>
              {opt.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setConfig({ orderDirection: config.orderDirection === 'asc' ? 'desc' : 'asc' })}>
          {config.orderDirection === 'asc' ? '升序 ↑' : '降序 ↓'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DisplayPopover({ config, setConfig }: { config: ViewConfig, setConfig: (p: Partial<ViewConfig>) => void }) {
  const properties: { key: keyof ViewConfig['displayProperties'], label: string }[] = [
    { key: 'id', label: '编号' },
    { key: 'priority', label: '优先级' },
    { key: 'status', label: '状态' },
    { key: 'labels', label: '标签' },
    { key: 'assignee', label: '负责人' },
    { key: 'agentIndicator', label: 'Agent 状态' },
    { key: 'milestone', label: '里程碑' },
    { key: 'dueDate', label: '截止日期' },
    { key: 'createdAt', label: '创建时间' },
  ]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarPill data-testid="kanban-display-btn" aria-label="Display options">
          <SlidersHorizontalIcon className="size-3.5" aria-hidden="true" />
        </ToolbarPill>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-0">
        <div className="p-2">
          {properties.map(p => (
            <label
              key={p.key}
              htmlFor={`kanban-display-${p.key}`}
              className="flex items-center gap-2 text-[13px] cursor-pointer px-1 py-0.5 rounded hover:bg-muted"
            >
              <Checkbox
                id={`kanban-display-${p.key}`}
                checked={config.displayProperties[p.key]}
                onCheckedChange={(checked) => {
                  setConfig({ displayProperties: { ...config.displayProperties, [p.key]: !!checked } })
                }}
              />
              {p.label}
            </label>
          ))}
          <div className="border-t border-border mt-1 pt-1">
            <label htmlFor="kanban-display-empty-groups" className="flex items-center gap-2 text-[13px] cursor-pointer px-1 py-0.5 rounded hover:bg-muted">
              <Checkbox
                id="kanban-display-empty-groups"
                checked={config.showEmptyGroups}
                onCheckedChange={checked => setConfig({ showEmptyGroups: !!checked })}
              />
              显示空分组
            </label>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
