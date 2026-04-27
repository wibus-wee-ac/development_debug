// Input: useAgentContextDevtoolStore
// Output: AgentContextEventsTable — list of agent context events in the devtool
// Position: Renderer component for the Agent Context devtool pane

import type { AgentContextEvent } from '@cradle/ipc'
import { cn } from '@renderer/lib/cn'

import { useAgentContextDevtoolStore } from './use-agent-context-events'

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 })
}

export function AgentContextEventsTable() {
  const events = useAgentContextDevtoolStore(s => s.events)
  const selectedEventId = useAgentContextDevtoolStore(s => s.selectedEventId)
  const selectEvent = useAgentContextDevtoolStore(s => s.selectEvent)

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground/50">
        No agent context events yet
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-left font-mono text-[11px]">
        <thead className="sticky top-0 bg-background">
          <tr className="border-b border-border text-muted-foreground">
            <th className="px-3 py-1.5 font-normal">Time</th>
            <th className="px-3 py-1.5 font-normal">Session</th>
            <th className="px-3 py-1.5 font-normal">Agent</th>
            <th className="px-3 py-1.5 font-normal">Provider</th>
            <th className="px-3 py-1.5 font-normal">History</th>
            <th className="px-3 py-1.5 font-normal">Skills</th>
            <th className="px-3 py-1.5 font-normal">Prompt</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event: AgentContextEvent) => (
            <tr
              key={event.id}
              onClick={() => selectEvent(event.id)}
              className={cn(
                'cursor-pointer border-b border-border/50 transition-colors hover:bg-foreground/3',
                selectedEventId === event.id && 'bg-foreground/5',
              )}
            >
              <td className="whitespace-nowrap px-3 py-1 text-muted-foreground">{formatTime(event.timestamp)}</td>
              <td className="px-3 py-1 text-muted-foreground">{event.chatSessionId.slice(0, 8)}</td>
              <td className="px-3 py-1">{event.agentName ?? '—'}</td>
              <td className="px-3 py-1 text-muted-foreground">{event.providerKind}</td>
              <td className="px-3 py-1">{event.historyLength}</td>
              <td className="px-3 py-1">{event.skillsCatalog.length}</td>
              <td className="px-3 py-1">
                {event.systemPrompt
                  ? (
                    <span className="text-emerald-500" title={event.systemPrompt}>
                      {event.systemPrompt.length}
                      {' '}
                      chars
                    </span>
                  )
                  : <span className="text-muted-foreground/40">none</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
