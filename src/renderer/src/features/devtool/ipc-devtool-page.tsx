// Input: IPC/ACP devtool sub-components, initialization hooks, keyboard hook
// Output: IpcDevtoolPage — full-screen shell that switches between IPC traces and ACP runtime output
// Position: Top-level component rendered by the /devtool TanStack Router route

import { useEffect, useState } from 'react'

import { AgentContextEventDetail } from './agent-context/agent-context-event-detail'
import { AgentContextEventsTable } from './agent-context/agent-context-events-table'
import { useAgentContextDevtoolStore } from './agent-context/use-agent-context-events'
import { AcpEventDetail } from './acp/acp-event-detail'
import { AcpEventsTable } from './acp/acp-events-table'
import { AcpFilterBar } from './acp/acp-filter-bar'
import { useAcpDevtoolStore } from './acp/use-acp-events'
import { useAcpKeyboard } from './acp/use-acp-keyboard'
import { IpcEventDetail } from './ipc/ipc-event-detail'
import { IpcEventsTable } from './ipc/ipc-events-table'
import { IpcFilterBar } from './ipc/ipc-filter-bar'
import { useIpcDevtoolStore } from './ipc/use-ipc-events'
import { ObservabilityEventDetail } from './observability/observability-event-detail'
import { ObservabilityEventsTable } from './observability/observability-events-table'
import { useObservabilityDevtoolStore } from './observability/use-observability-events'
import { useIpcKeyboard } from './ipc/use-ipc-keyboard'

export function IpcDevtoolPage() {
  const initializeIpc = useIpcDevtoolStore(s => s.initialize)
  const initializeAcp = useAcpDevtoolStore(s => s.initialize)
  const initializeAgentContext = useAgentContextDevtoolStore(s => s.initialize)
  const initializeObservability = useObservabilityDevtoolStore(s => s.initialize)
  const [mode, setMode] = useState<'ipc' | 'acp' | 'agent-context' | 'observability'>('ipc')

  useEffect(() => {
    void Promise.all([initializeIpc(), initializeAcp(), initializeAgentContext(), initializeObservability()])
  }, [initializeAcp, initializeAgentContext, initializeIpc, initializeObservability])

  useIpcKeyboard(mode === 'ipc')
  useAcpKeyboard(mode === 'acp')

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        <button
          type="button"
          onClick={() => setMode('ipc')}
          className={mode === 'ipc'
            ? 'rounded border border-border bg-muted px-2 py-1 text-foreground'
            : 'rounded border border-transparent px-2 py-1 hover:border-border hover:bg-muted/40'}
        >
          IPC
        </button>
        <button
          type="button"
          onClick={() => setMode('acp')}
          className={mode === 'acp'
            ? 'rounded border border-border bg-muted px-2 py-1 text-foreground'
            : 'rounded border border-transparent px-2 py-1 hover:border-border hover:bg-muted/40'}
        >
          ACP
        </button>
        <button
          type="button"
          onClick={() => setMode('agent-context')}
          className={mode === 'agent-context'
            ? 'rounded border border-border bg-muted px-2 py-1 text-foreground'
            : 'rounded border border-transparent px-2 py-1 hover:border-border hover:bg-muted/40'}
        >
          Agent Context
        </button>
        <button
          type="button"
          onClick={() => setMode('observability')}
          className={mode === 'observability'
            ? 'rounded border border-border bg-muted px-2 py-1 text-foreground'
            : 'rounded border border-transparent px-2 py-1 hover:border-border hover:bg-muted/40'}
        >
          Observability
        </button>
        <div className="ml-auto">/devtool</div>
      </div>
      {mode === 'ipc' && <IpcFilterBar />}
      {mode === 'acp' && <AcpFilterBar />}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-3 overflow-hidden border-r border-border">
          {mode === 'ipc' && <IpcEventsTable />}
          {mode === 'acp' && <AcpEventsTable />}
          {mode === 'agent-context' && <AgentContextEventsTable />}
          {mode === 'observability' && <ObservabilityEventsTable />}
        </div>
        <div className="flex-2 overflow-hidden">
          {mode === 'ipc' && <IpcEventDetail />}
          {mode === 'acp' && <AcpEventDetail />}
          {mode === 'agent-context' && <AgentContextEventDetail />}
          {mode === 'observability' && <ObservabilityEventDetail />}
        </div>
      </div>
    </div>
  )
}
