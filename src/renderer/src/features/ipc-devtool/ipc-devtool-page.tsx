// Input: ipc-devtool sub-components (filter bar, table, detail), initialisation hook, keyboard hook
// Output: IpcDevtoolPage — full-screen shell that wires preload subscriptions and shortcuts to the three panes
// Position: Top-level component rendered by the /devtool TanStack Router route

import { useEffect } from 'react'

import { IpcEventDetail } from './ipc-event-detail'
import { IpcEventsTable } from './ipc-events-table'
import { IpcFilterBar } from './ipc-filter-bar'
import { useIpcDevtoolStore } from './use-ipc-events'
import { useIpcKeyboard } from './use-ipc-keyboard'

export function IpcDevtoolPage() {
  const initialize = useIpcDevtoolStore(s => s.initialize)

  useEffect(() => {
    void initialize()
  }, [initialize])

  useIpcKeyboard()

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <IpcFilterBar />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-[3] overflow-hidden border-r border-border">
          <IpcEventsTable />
        </div>
        <div className="flex-[2] overflow-hidden">
          <IpcEventDetail />
        </div>
      </div>
    </div>
  )
}
