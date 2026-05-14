// Input: ViewConfig, FilterState, callbacks
// Output: Compact toolbar with search, filter, group, sort, display, and layout controls
// Position: Kanban toolbar component

import {
  ChevronDownIcon,
  ColumnsIcon,
  FilterIcon,
  GroupIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SortAscIcon,
} from 'lucide-react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
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
  onOpenSettings?: () => void
}

export function KanbanToolbar({
  config,
  setConfig,
  filter,
  setFilter,
  resetFilter,
  searchQuery,
  onSearchChange,
  onCreateIssue,
  onOpenSettings,
}: ToolbarProps) {
  const hasFilter = !!(
    filter.statusIds?.length
    || filter.priorities?.length
    || filter.labels?.length
    || filter.milestoneId
    || filter.isDelegated != null
  )

  return (
    <div className="flex items-center gap-1.5 px-4 py-2">
      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="搜索..."
          className="h-7 w-48 pl-7 text-[13px]"
          data-testid="kanban-search-input"
        />
      </div>

      {/* Filter */}
      <FilterPopover filter={filter} setFilter={setFilter} resetFilter={resetFilter} hasFilter={hasFilter} />

      {/* Group By */}
      <GroupByPopover config={config} setConfig={setConfig} />

      {/* Sort */}
      <SortPopover config={config} setConfig={setConfig} />

      {/* Display */}
      <DisplayPopover config={config} setConfig={setConfig} />

      <div className="flex-1" />

      {/* Create issue */}
      {onCreateIssue && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-[13px]"
          onClick={onCreateIssue}
          data-testid="kanban-create-issue-btn"
        >
          <PlusIcon className="size-3.5" />
          新建
        </Button>
      )}

      {/* Settings */}
      {onOpenSettings && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-[13px]"
          onClick={onOpenSettings}
          data-testid="kanban-settings-btn"
        >
          <SlidersHorizontalIcon className="size-3.5" />
        </Button>
      )}

      {/* Layout toggle */}
      <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
        <button
          onClick={() => setConfig({ layout: 'board' })}
          className={cn(
            'flex items-center justify-center size-6 rounded-sm transition-colors',
            config.layout === 'board' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <ColumnsIcon className="size-3.5" />
        </button>
        <button
          onClick={() => setConfig({ layout: 'list' })}
          className={cn(
            'flex items-center justify-center size-6 rounded-sm transition-colors',
            config.layout === 'list' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <ListIcon className="size-3.5" />
        </button>
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
      <PopoverTrigger>
        <Button variant="ghost" size="sm" className={cn('h-7 gap-1 text-[13px]', hasFilter && 'text-foreground')}>
          <FilterIcon className="size-3.5" />
          筛选
          {hasFilter && <span className="size-1.5 rounded-full bg-blue-500" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-3">
        <div className="space-y-3">
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
            <Button variant="ghost" size="sm" className="w-full h-7 text-[12px]" onClick={resetFilter}>
              清除筛选
            </Button>
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
      <PopoverTrigger>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-[13px]">
          <GroupIcon className="size-3.5" />
          分组
          <ChevronDownIcon className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40 p-2">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => setConfig({ groupBy: opt.value })}
            className={cn(
              'w-full text-left px-2 py-1.5 rounded-md text-[13px] transition-colors',
              config.groupBy === opt.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            {opt.label}
          </button>
        ))}
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
      <PopoverTrigger>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-[13px]">
          <SortAscIcon className="size-3.5" />
          排序
          <ChevronDownIcon className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40 p-2">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => setConfig({ orderBy: opt.value })}
            className={cn(
              'w-full text-left px-2 py-1.5 rounded-md text-[13px] transition-colors',
              config.orderBy === opt.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            {opt.label}
          </button>
        ))}
        <div className="border-t border-border mt-1.5 pt-1.5">
          <button
            onClick={() => setConfig({ orderDirection: config.orderDirection === 'asc' ? 'desc' : 'asc' })}
            className="w-full text-left px-2 py-1.5 rounded-md text-[13px] text-muted-foreground hover:bg-muted/50"
          >
            {config.orderDirection === 'asc' ? '升序 ↑' : '降序 ↓'}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function DisplayPopover({ config, setConfig }: { config: ViewConfig, setConfig: (p: Partial<ViewConfig>) => void }) {
  const [open, setOpen] = useState(false)

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-[13px]">
          <SlidersHorizontalIcon className="size-3.5" />
          显示
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-3">
        <div className="space-y-1">
          {properties.map(p => (
            <label key={p.key} className="flex items-center gap-2 text-[13px] cursor-pointer">
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
        </div>
        <div className="border-t border-border mt-2 pt-2">
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <Checkbox
              checked={config.showEmptyGroups}
              onCheckedChange={(checked) => setConfig({ showEmptyGroups: !!checked })}
            />
            显示空分组
          </label>
        </div>
      </PopoverContent>
    </Popover>
  )
}
