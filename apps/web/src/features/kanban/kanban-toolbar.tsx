// Input: ViewConfig, FilterState, callbacks
// Output: Compact toolbar with icon pill buttons
// Position: Kanban toolbar component

import {
  CheckIcon,
  ColumnsIcon,
  FilterIcon,
  GroupIcon,
  ListIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  SortAscIcon,
} from 'lucide-react'

import { Checkbox } from '~/components/ui/checkbox'
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
        'flex items-center justify-center size-7 rounded-full border border-border shadow-sm',
        'transition-[background-color,transform] duration-150 ease-out',
        'hover:bg-muted active:scale-[0.92]',
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

      {/* Right: icon pills */}
      <div className="flex items-center gap-1">
        <FilterPopover filter={filter} setFilter={setFilter} resetFilter={resetFilter} hasFilter={hasFilter} />

        <GroupByPopover config={config} setConfig={setConfig} />

        <SortPopover config={config} setConfig={setConfig} />

        <DisplayPopover config={config} setConfig={setConfig} />

        {onCreateIssue && (
          <ToolbarPill
            onClick={onCreateIssue}
            data-testid="kanban-create-issue-btn"
          >
            <PlusIcon className="size-3.5" />
          </ToolbarPill>
        )}

        {/* Layout toggle */}
        <div className="flex items-center gap-0.5 ml-1 rounded-full border border-border p-0.5">
          <button
            onClick={() => setConfig({ layout: 'board' })}
            className={cn(
              'flex items-center justify-center size-6 rounded-full',
              'transition-colors duration-100',
              config.layout === 'board' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ColumnsIcon className="size-3.5" />
          </button>
          <button
            onClick={() => setConfig({ layout: 'list' })}
            className={cn(
              'flex items-center justify-center size-6 rounded-full',
              'transition-colors duration-100',
              config.layout === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ListIcon className="size-3.5" />
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
        <ToolbarPill active={hasFilter} data-testid="kanban-filter-btn">
          <FilterIcon className="size-3.5" />
        </ToolbarPill>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <div className="p-3 space-y-3">
          <div>
            <p className="text-[12px] font-medium text-muted-foreground mb-1.5">优先级</p>
            <div className="space-y-1">
              {priorities.map(p => (
                <label key={p} className="flex items-center gap-2 text-[13px] cursor-pointer">
                  <Checkbox
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
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <Checkbox
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

function GroupByPopover({ config, setConfig }: { config: ViewConfig, setConfig: (p: Partial<ViewConfig>) => void }) {
  const options = [
    { value: 'status', label: '状态' },
    { value: 'priority', label: '优先级' },
    { value: 'milestone', label: '里程碑' },
    { value: 'assignee', label: '负责人' },
    { value: 'label', label: '标签' },
  ] as const

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarPill data-testid="kanban-group-btn">
          <GroupIcon className="size-3.5" />
        </ToolbarPill>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-0">
        <div className="p-1">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => setConfig({ groupBy: opt.value })}
              className={cn(
                'w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-[13px] transition-colors',
                config.groupBy === opt.value ? 'text-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <span className="flex-1">{opt.label}</span>
              {config.groupBy === opt.value && <CheckIcon className="size-3 text-muted-foreground" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SortPopover({ config, setConfig }: { config: ViewConfig, setConfig: (p: Partial<ViewConfig>) => void }) {
  const options = [
    { value: 'manual', label: '手动' },
    { value: 'priority', label: '优先级' },
    { value: 'created', label: '创建时间' },
    { value: 'updated', label: '更新时间' },
    { value: 'status', label: '状态' },
  ] as const

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarPill data-testid="kanban-sort-btn">
          <SortAscIcon className="size-3.5" />
        </ToolbarPill>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-0">
        <div className="p-1">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => setConfig({ orderBy: opt.value })}
              className={cn(
                'w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-[13px] transition-colors',
                config.orderBy === opt.value ? 'text-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <span className="flex-1">{opt.label}</span>
              {config.orderBy === opt.value && <CheckIcon className="size-3 text-muted-foreground" />}
            </button>
          ))}
          <div className="border-t border-border mt-1 pt-1">
            <button
              onClick={() => setConfig({ orderDirection: config.orderDirection === 'asc' ? 'desc' : 'asc' })}
              className="w-full text-left px-2 py-1.5 rounded-md text-[13px] text-muted-foreground hover:bg-muted"
            >
              {config.orderDirection === 'asc' ? '升序 ↑' : '降序 ↓'}
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
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
        <ToolbarPill data-testid="kanban-display-btn">
          <SlidersHorizontalIcon className="size-3.5" />
        </ToolbarPill>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-0">
        <div className="p-2">
          {properties.map(p => (
            <label key={p.key} className="flex items-center gap-2 text-[13px] cursor-pointer px-1 py-0.5 rounded hover:bg-muted">
              <Checkbox
                checked={config.displayProperties[p.key]}
                onCheckedChange={(checked) => {
                  setConfig({
                    displayProperties: {
                      ...config.displayProperties,
                      [p.key]: !!checked,
                    },
                  })
                }}
              />
              {p.label}
            </label>
          ))}
          <div className="border-t border-border mt-1 pt-1">
            <label className="flex items-center gap-2 text-[13px] cursor-pointer px-1 py-0.5 rounded hover:bg-muted">
              <Checkbox
                checked={config.showEmptyGroups}
                onCheckedChange={(checked) => setConfig({ showEmptyGroups: !!checked })}
              />
              显示空分组
            </label>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
