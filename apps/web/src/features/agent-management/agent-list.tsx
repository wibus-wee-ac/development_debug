import { BotIcon, ChevronRightIcon, PlusIcon, SearchIcon, SparklesIcon, XIcon } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'
import { AgentRuntimeConfigJsonSchema } from '~/features/agent-runtime/agent-config-schema'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { cn } from '~/lib/cn'
import type { Agent, AgentProfile, CliTuiLaunchConfig } from '~/lib/types'

import { AgentDetailPage } from './agent-detail'
import { StatusDot } from './agent-runtime-settings'
import { buildAvatarUrl } from './avatar-url'

// ── Constants ─────────────────────────────────────────────────────────────────

const DRAFT_ID = '__agent-draft__'

// ── Sidebar row ───────────────────────────────────────────────────────────────

function AgentSidebarRow({
  agent,
  profiles,
  active,
  onClick,
}: {
  agent: Agent
  profiles: AgentProfile[]
  active: boolean
  onClick: () => void
}) {
  const avatarUrl = agent.avatarUrl || buildAvatarUrl(agent.avatarStyle, agent.avatarSeed)
  const profile = profiles.find(p => p.id === agent.agentProfileId)
  const cliTuiLaunch = agent.runtimeKind === 'cli-tui' ? AgentRuntimeConfigJsonSchema.parse(agent.configJson).cliTui : null
  const subtitle = agent.runtimeKind === 'cli-tui'
    ? ['CLI TUI', cliTuiLaunch?.preset ?? cliTuiLaunch?.executable].filter(Boolean).join(' ·\n') || 'CLI TUI'
    : [profile?.name, agent.modelId].filter(Boolean).join(' ·\n') || undefined

  return (
    <button
      type="button"
      data-testid={`agent-sidebar-row-${agent.id}`}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'group/sidebar-row relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none',
        'transition-[background-color,opacity,scale] duration-150',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        active
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-foreground/[0.035] active:bg-foreground/6 active:scale-[0.98]',
        !agent.enabled && !active && 'opacity-60',
      )}
    >
      <div className="size-7 shrink-0 overflow-hidden rounded-lg bg-foreground/5">
        <img
          src={avatarUrl}
          alt={agent.name}
          className="size-full object-cover"
          crossOrigin="anonymous"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn(
            'block truncate text-[12.5px] leading-tight',
            active ? 'font-medium text-foreground' : 'text-foreground/90',
          )}
          >
            {agent.name}
          </span>
          <StatusDot tone={agent.enabled ? 'active' : 'muted'} />
        </div>
        {subtitle && (
          <span className="block text-[10.5px] leading-tight text-muted-foreground/70 truncate whitespace-pre">
            {subtitle}
          </span>
        )}
      </div>
      <ChevronRightIcon
        className={cn(
          'size-3 shrink-0 text-muted-foreground/40 transition-[opacity,transform] duration-150',
          active
            ? 'opacity-100 translate-x-0'
            : 'opacity-0 -translate-x-1 group-hover/sidebar-row:opacity-60 group-hover/sidebar-row:translate-x-0',
        )}
      />
    </button>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AgentList() {
  const { agents, isLoading } = useAgents()
  const { profiles } = useAgentProfiles()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isDrafting, setIsDrafting] = useState(false)
  const [filter, setFilter] = useState('')

  const visibleAgents = useMemo(() => {
    if (!filter.trim()) {
      return agents
    }
    const q = filter.trim().toLowerCase()
    return agents.filter(a => a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q))
  }, [agents, filter])

  const selectedAgent = useMemo(
    () => (selectedId && selectedId !== DRAFT_ID) ? agents.find(a => a.id === selectedId) : undefined,
    [agents, selectedId],
  )

  const isDraftSelected = isDrafting && selectedId === DRAFT_ID

  // If the selected agent gets removed, clear selection
  useEffect(() => {
    if (!selectedId || selectedId === DRAFT_ID) {
      return
    }
    if (!agents.some(a => a.id === selectedId)) {
      setSelectedId(null)
    }
  }, [agents, selectedId])

  const startDraft = useCallback(() => {
    setIsDrafting(true)
    setSelectedId(DRAFT_ID)
  }, [])

  const handleCreated = useCallback((newAgentId: string) => {
    setIsDrafting(false)
    setSelectedId(newAgentId)
  }, [])

  const handleDeleted = useCallback(() => {
    setSelectedId(null)
  }, [])

  return (
    <div
      data-testid="agent-list"
      className="flex h-full flex-col overflow-hidden"
    >
      {/* Header */}
      <header className="flex items-end justify-between gap-6 pb-5">
        <div className="space-y-1">
          <h3 className="font-heading text-[15px] font-medium tracking-tight text-foreground text-balance">
            Agents
          </h3>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Create AI agents with unique identities, personas, and runtime profiles.
          </p>
        </div>
        <Button
          data-testid="new-agent-btn"
          size="sm"
          onClick={startDraft}
          disabled={isDrafting}
        >
          <PlusIcon />
          Add agent
        </Button>
      </header>

      <Separator className="bg-foreground/6" />

      {/* Body — master-detail */}
      <div className="grid flex-1 grid-cols-[260px_1fr] gap-0 overflow-hidden">
        {/* ── Left rail ────────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-3 overflow-hidden py-4 pr-4 border-r border-foreground/6">
          {/* Search */}
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search agents"
              className="h-8 pl-8 pr-2 text-[12.5px]"
            />
          </div>

          {/* List */}
          <ScrollArea className="-mx-1 flex-1">
            <div className="flex flex-col gap-0.5 px-1">
              {/* Draft row */}
              <AnimatePresence initial={false}>
                {isDrafting && (
                  <m.div
                    key={DRAFT_ID}
                    initial={{ opacity: 0, y: -4, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: -4, height: 0 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(DRAFT_ID)}
                      aria-pressed={isDraftSelected}
                      className={cn(
                        'group/sidebar-row relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none',
                        'transition-[background-color] duration-150',
                        'focus-visible:ring-2 focus-visible:ring-ring/50',
                        isDraftSelected
                          ? 'bg-accent text-accent-foreground'
                          : 'opacity-90 hover:bg-foreground/[0.035]',
                      )}
                    >
                      <span className="flex size-7 items-center justify-center rounded-lg border border-dashed border-foreground/15 text-muted-foreground">
                        <SparklesIcon className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] leading-tight text-foreground/70">
                          New agent
                        </span>
                        <span className="block truncate text-[10.5px] leading-tight text-muted-foreground/60">
                          Set up identity
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setIsDrafting(false)
                          setSelectedId(null)
                        }}
                        className="shrink-0 rounded p-0.5 text-muted-foreground/40 hover:text-muted-foreground"
                      >
                        <XIcon className="size-3" />
                      </button>
                    </button>
                  </m.div>
                )}
              </AnimatePresence>

              {/* Agent rows */}
              {!isLoading && visibleAgents.map(agent => (
                <AgentSidebarRow
                  key={agent.id}
                  agent={agent}
                  profiles={profiles}
                  active={selectedId === agent.id && !isDraftSelected}
                  onClick={() => {
                    setSelectedId(agent.id)
                    setIsDrafting(false)
                  }}
                />
              ))}

              {/* Empty state inside list */}
              {!isLoading && visibleAgents.length === 0 && !isDrafting && (
                <div className="px-2 py-6 text-center">
                  <p className="text-[11.5px] text-muted-foreground/70">
                    {filter ? 'No matches' : 'No agents yet'}
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer hint */}
          {agents.length > 0 && (
            <div className="px-1 pt-1 text-[10.5px] tabular-nums text-muted-foreground/60">
              {agents.length}
              {' '}
              agent
              {agents.length === 1 ? '' : 's'}
              {' '}
              ·
              {' '}
              {agents.filter(a => a.enabled).length}
              {' '}
              active
            </div>
          )}
        </aside>

        {/* ── Right panel ──────────────────────────────────────────────── */}
        <section className="flex flex-col overflow-y-auto py-4 pl-6 pr-2">
          {isDraftSelected
            ? (
              <div key={DRAFT_ID} className="flex-1">
                <AgentDetailPage
                  profiles={profiles}
                  onCreated={handleCreated}
                  onDeleted={handleDeleted}
                />
              </div>
            )
            : selectedAgent
              ? (
                <div key={selectedAgent.id} className="flex-1">
                  <AgentDetailPage
                    agent={selectedAgent}
                    profiles={profiles}
                    onDeleted={handleDeleted}
                  />
                </div>
              )
              : (
                <div className="flex flex-1 items-center justify-center">
                  <Empty className="border-none">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <BotIcon />
                      </EmptyMedia>
                      <EmptyTitle>No agent selected</EmptyTitle>
                      <EmptyDescription>
                        Pick an agent on the left to view its configuration, or
                        add a new one to get started.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button size="sm" variant="outline" onClick={startDraft} disabled={isDrafting}>
                        <PlusIcon />
                        Add agent
                      </Button>
                    </EmptyContent>
                  </Empty>
                </div>
              )}
        </section>
      </div>
    </div>
  )
}
