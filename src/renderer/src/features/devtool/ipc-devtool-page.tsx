// Input: IPC/ACP devtool sub-components, initialization hooks, keyboard hook
// Output: IpcDevtoolPage — full-screen shell that switches between IPC traces and ACP runtime output
// Position: Top-level component rendered by the /devtool TanStack Router route

import { useEffect, useState } from 'react'

import { AcpEventDetail } from './acp/acp-event-detail'
import { AcpEventsTable } from './acp/acp-events-table'
import { AcpFilterBar } from './acp/acp-filter-bar'
import { IpcEventDetail } from './ipc/ipc-event-detail'
import { IpcEventsTable } from './ipc/ipc-events-table'
import { IpcFilterBar } from './ipc/ipc-filter-bar'
import { useAcpDevtoolStore } from './acp/use-acp-events'
import { useAcpKeyboard } from './acp/use-acp-keyboard'
import { useIpcDevtoolStore } from './ipc/use-ipc-events'
import { useIpcKeyboard } from './ipc/use-ipc-keyboard'

export function IpcDevtoolPage() {
  const initializeIpc = useIpcDevtoolStore(s => s.initialize)
  const initializeAcp = useAcpDevtoolStore(s => s.initialize)
  const [mode, setMode] = useState<'ipc' | 'acp'>('ipc')

  useEffect(() => {
    void Promise.all([initializeIpc(), initializeAcp()])
  }, [initializeAcp, initializeIpc])

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
        <div className="ml-auto">/devtool</div>
      </div>
      {mode === 'ipc' ? <IpcFilterBar /> : <AcpFilterBar />}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-3 overflow-hidden border-r border-border">
          {mode === 'ipc' ? <IpcEventsTable /> : <AcpEventsTable />}
        </div>
        <div className="flex-2 overflow-hidden">
          {mode === 'ipc' ? <IpcEventDetail /> : <AcpEventDetail />}
        </div>
      </div>
    </div>
  )
}
