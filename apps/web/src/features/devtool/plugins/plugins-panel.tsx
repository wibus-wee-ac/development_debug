import { useState } from 'react'

import { cn } from '~/lib/cn'
import { usePluginStore } from '~/lib/plugin-store'

import { PluginGraph } from './plugin-graph'
import type { PluginInfo } from './use-plugin-data'
import { usePluginData } from './use-plugin-data'

function formatTimeSince(ts: number | undefined): string {
  if (!ts) return '—'
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export function PluginsPanel() {
  const { plugins, loading, error, refresh, getActivatedAt } = usePluginData()
  const panels = usePluginStore(s => s.panels)
  const commands = usePluginStore(s => s.commands)
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null)

  const serverCount = plugins.filter(p => p.hasServer).length
  const webCount = plugins.filter(p => p.hasWeb).length
  const desktopCount = plugins.filter(p => p.hasDesktop).length

  return (
    <div className="h-full overflow-auto p-4 font-mono text-[11px]">
      {/* Stats bar */}
      {!loading && !error && (
        <div className="mb-3 flex items-center gap-2 text-muted-foreground">
          <span>{plugins.length} plugins</span>
          <span>|</span>
          <span>{serverCount} server</span>
          <span>|</span>
          <span>{webCount} web</span>
          <span>|</span>
          <span>{desktopCount} desktop</span>
          <span>|</span>
          <span>{panels.length} panel</span>
          <span>|</span>
          <span>{commands.length} command</span>
        </div>
      )}

      {/* Topology Graph */}
      {!loading && !error && plugins.length > 0 && (
        <PluginGraph plugins={plugins} panels={panels} commands={commands} />
      )}

      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-foreground font-medium">Plugins</span>
        <span className="text-muted-foreground">({plugins.length})</span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-fill hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      {/* Loading / Error */}
      {loading && <div className="text-muted-foreground">Loading...</div>}
      {error && <div className="text-red-400">Error: {error}</div>}

      {/* Plugin list */}
      {!loading && !error && (
        <div className="space-y-2">
          {plugins.map(p => (
            <PluginListItem
              key={p.name}
              plugin={p}
              expanded={expandedPlugin === p.name}
              onToggle={() => setExpandedPlugin(expandedPlugin === p.name ? null : p.name)}
              activatedAt={getActivatedAt(p.name)}
              hasRegistrations={panels.length > 0 || commands.length > 0}
              commands={commands}
            />
          ))}
          {plugins.length === 0 && (
            <div className="text-muted-foreground">No plugins registered.</div>
          )}
        </div>
      )}

      {/* Client-side registrations */}
      <div className="mt-6 border-t border-border pt-4">
        <div className="mb-2 text-foreground font-medium">Client Registrations</div>

        {/* Panels */}
        <div className="mb-3">
          <div className="mb-1 text-muted-foreground">Panels ({panels.length})</div>
          {panels.length === 0 && (
            <div className="text-muted-foreground/60">None</div>
          )}
          {panels.map(panel => (
            <div key={panel.id} className="flex items-center gap-2 py-0.5">
              <span className="text-foreground">{panel.title}</span>
              <span className="text-muted-foreground">{panel.id}</span>
              {panel.location && (
                <span className="rounded bg-fill px-1 text-muted-foreground">
                  {panel.location}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Commands */}
        <div>
          <div className="mb-1 text-muted-foreground">Commands ({commands.length})</div>
          {commands.length === 0 && (
            <div className="text-muted-foreground/60">None</div>
          )}
          {commands.map(cmd => (
            <div key={cmd.id} className="flex items-center gap-2 py-0.5">
              <button
                type="button"
                onClick={() => void cmd.execute()}
                className="rounded border border-border px-1 py-0.5 text-muted-foreground hover:bg-fill hover:text-foreground"
                title="Execute command"
              >
                ▶
              </button>
              <span className="text-foreground">{cmd.title}</span>
              <span className="text-muted-foreground">{cmd.id}</span>
              {cmd.keybinding && (
                <span className="rounded bg-fill px-1 text-muted-foreground">
                  {cmd.keybinding}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PluginListItem({
  plugin,
  expanded,
  onToggle,
  activatedAt,
  hasRegistrations,
  commands,
}: {
  plugin: PluginInfo
  expanded: boolean
  onToggle: () => void
  activatedAt: number | undefined
  hasRegistrations: boolean
  commands: Array<{ id: string; title: string; execute(): void | Promise<void> }>
}) {
  const isActive = hasRegistrations && plugin.hasWeb

  return (
    <div className="rounded border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 p-2 text-left hover:bg-fill"
      >
        {/* Status dot */}
        <span
          className={cn(
            'inline-block size-1.5 shrink-0 rounded-full',
            isActive ? 'bg-emerald-400' : 'bg-muted-foreground/30',
          )}
        />
        <span className="text-foreground">{plugin.displayName || plugin.name}</span>
        <span className="text-muted-foreground">{plugin.version}</span>
        <div className="ml-auto flex gap-1">
          {plugin.hasServer && <PlatformBadge label="server" variant="blue" />}
          {plugin.hasWeb && <PlatformBadge label="web" variant="purple" />}
          {plugin.hasDesktop && <PlatformBadge label="desktop" variant="amber" />}
        </div>
        <span className="text-muted-foreground">{expanded ? '▾' : '▸'}</span>
      </button>

      {plugin.description && !expanded && (
        <div className="px-2 pb-2 text-muted-foreground">{plugin.description}</div>
      )}

      {expanded && (
        <div className="border-t border-border p-2 space-y-2">
          {plugin.description && (
            <div className="text-muted-foreground">{plugin.description}</div>
          )}

          {/* Entry points */}
          <div className="space-y-0.5">
            <div className="text-muted-foreground font-medium">Entry Points</div>
            {plugin.hasServer && (
              <div className="flex gap-2">
                <span className="text-muted-foreground">server:</span>
                <span className="text-foreground">{plugin.serverEntry || '—'}</span>
              </div>
            )}
            {plugin.hasWeb && (
              <div className="flex gap-2">
                <span className="text-muted-foreground">web:</span>
                <span className="text-foreground">{plugin.webEntry || '—'}</span>
              </div>
            )}
            {plugin.hasDesktop && (
              <div className="flex gap-2">
                <span className="text-muted-foreground">desktop:</span>
                <span className="text-foreground">{plugin.desktopEntry || '—'}</span>
              </div>
            )}
          </div>

          {/* Activation time */}
          <div className="flex gap-2">
            <span className="text-muted-foreground">Activated:</span>
            <span className="text-foreground">{formatTimeSince(activatedAt)}</span>
          </div>

          {/* Commands belonging to this plugin */}
          {commands.length > 0 && plugin.hasWeb && (
            <div className="space-y-0.5">
              <div className="text-muted-foreground font-medium">Commands</div>
              {commands.map(cmd => (
                <div key={cmd.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void cmd.execute()}
                    className="rounded border border-border px-1 py-0.5 text-muted-foreground hover:bg-fill hover:text-foreground"
                    title="Execute command"
                  >
                    ▶
                  </button>
                  <span className="text-foreground">{cmd.title}</span>
                  <span className="text-muted-foreground">{cmd.id}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PlatformBadge({ label, variant }: { label: string; variant: 'blue' | 'purple' | 'amber' }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px]',
        {
          'bg-blue-500/15 text-blue-400': variant === 'blue',
          'bg-purple-500/15 text-purple-400': variant === 'purple',
          'bg-amber-500/15 text-amber-400': variant === 'amber',
        },
      )}
    >
      {label}
    </span>
  )
}
