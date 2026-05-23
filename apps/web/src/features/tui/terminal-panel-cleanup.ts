// Output: Owner-scoped cleanup helpers for bottom-panel terminal PTY sessions.
// Input: A terminal panel owner id derived from Cradle tab ownership.
// Position: Owned by TUI so tab lifecycle code does not manage PTY details directly.

import { stopShell } from './shell-api'
import { useTerminalPanelStore } from './terminal-panel-store'

export function stopTerminalPanelOwner(ownerId: string): void {
  const sessions = useTerminalPanelStore.getState().removeOwner(ownerId)

  for (const session of sessions) {
    void stopShell(session.id).catch(() => {})
  }
}

export function stopTerminalPanelOwners(ownerIds: Iterable<string>): void {
  for (const ownerId of ownerIds) {
    stopTerminalPanelOwner(ownerId)
  }
}
