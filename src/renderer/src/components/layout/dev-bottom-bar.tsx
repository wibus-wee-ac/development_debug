// Input: shared ipc proxy for calling ipcDevtool.openWindow, cn utility
// Output: DevBottomBar — dev-only slim footer with a single button opening the IPC devtool window
// Position: Bottom chrome of AppLayout, rendered only in dev mode

import { ipc } from '@renderer/lib/ipc'

export function DevBottomBar() {
  return (
    <footer className="flex h-6 shrink-0 items-center justify-end border-t border-border bg-muted/30 px-2 font-mono text-[10px]">
      <button
        type="button"
        onClick={() => {
          void ipc?.ipcDevtool.openWindow()
        }}
        className="rounded px-2 py-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      >
        IPC Devtool
      </button>
    </footer>
  )
}
