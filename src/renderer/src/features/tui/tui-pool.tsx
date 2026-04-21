// Input: useTuiPoolStore, TuiView
// Output: TuiPool — keep-alive container for all active CLI TUI sessions
// Position: Portals into #tui-root (permanent DOM node outside React router tree)

import { useTuiPoolStore } from '@renderer/store/tui-pool'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { TuiView } from './tui-view'

const tuiRoot = document.getElementById('tui-root')!

/**
 * Each TUI session gets a persistent wrapper div.
 * Visibility is toggled via CSS — the component never unmounts.
 */
function TuiSessionLayer({ sessionId, active }: { sessionId: string; active: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: active ? 'flex' : 'none',
        pointerEvents: active ? 'auto' : 'none',
      }}
    >
      <TuiView sessionId={sessionId} />
    </div>
  )
}

export function TuiPool() {
  const sessions = useTuiPoolStore(s => s.sessions)
  const activeId = useTuiPoolStore(s => s.activeId)

  // Show/hide the root container based on whether a TUI session is active
  useEffect(() => {
    if (tuiRoot) {
      tuiRoot.style.visibility = activeId ? 'visible' : 'hidden'
      tuiRoot.style.pointerEvents = activeId ? 'auto' : 'none'
    }
  }, [activeId])

  if (sessions.length === 0) return null

  return createPortal(
    <>
      {sessions.map(sessionId => (
        <TuiSessionLayer key={sessionId} sessionId={sessionId} active={sessionId === activeId} />
      ))}
    </>,
    tuiRoot,
  )
}
