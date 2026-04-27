// Input: useAgentContextDevtoolStore
// Output: AgentContextEventDetail — detail view for selected agent context event
// Position: Renderer component for the Agent Context devtool pane (right panel)

import { useMemo } from 'react'

import { useAgentContextDevtoolStore } from './use-agent-context-events'

export function AgentContextEventDetail() {
  const events = useAgentContextDevtoolStore(s => s.events)
  const selectedEventId = useAgentContextDevtoolStore(s => s.selectedEventId)

  const event = useMemo(
    () => events.find(e => e.id === selectedEventId),
    [events, selectedEventId],
  )

  if (!event) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground/50">
        Select an event to inspect
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-3 font-mono text-[11px]">
      <div className="space-y-4">
        <Section title="Meta">
          <Row label="Session" value={event.chatSessionId} />
          <Row label="Agent" value={event.agentName ?? '(none)'} />
          <Row label="Agent ID" value={event.agentId ?? '(none)'} />
          <Row label="Provider" value={event.providerKind} />
          <Row label="History" value={`${event.historyLength} messages`} />
          {event.providerKind === 'acp-chat' && event.historyLength === 0 && (
            <div className="mt-1 text-[10px] text-muted-foreground/50">
              ACP providers manage their own session state — history and skills are not injected by Cradle.
            </div>
          )}
          <Row label="Time" value={new Date(event.timestamp).toISOString()} />
        </Section>

        {event.systemPrompt && (
          <Section title="System Prompt">
            <pre className="whitespace-pre-wrap wrap-break-word text-foreground/80">{event.systemPrompt}</pre>
          </Section>
        )}

        {event.skillsCatalog.length > 0 && (
          <Section title={`Skills (${event.skillsCatalog.length})`}>
            {event.skillsCatalog.map(skill => (
              <div key={skill.name} className="border-b border-border/30 py-1">
                <div className="font-semibold text-foreground">{skill.name}</div>
                <div className="text-muted-foreground">{skill.description}</div>
                <div className="text-muted-foreground/50">{skill.location}</div>
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] text-muted-foreground">{title}</div>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="shrink-0 text-muted-foreground">
        {label}
        :
      </span>
      <span className="break-all text-foreground">{value}</span>
    </div>
  )
}
