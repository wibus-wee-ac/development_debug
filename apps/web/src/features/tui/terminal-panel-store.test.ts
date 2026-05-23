// Output: Regression coverage for runtime-only bottom terminal panel owner state.
// Input: Terminal panel owner registration, session creation, and owner removal.
// Position: TUI feature tests for renderer-side terminal panel state.

import { afterEach, describe, expect, it } from 'vitest'

import { useTerminalPanelStore } from './terminal-panel-store'

afterEach(() => {
  useTerminalPanelStore.setState({ owners: {} })
})

describe('terminal panel store', () => {
  it('removes an owner and returns the sessions that need PTY cleanup', () => {
    const store = useTerminalPanelStore.getState()

    store.registerOwner('chat:session-1', '/tmp/workspace')
    store.addSession('chat:session-1', '/tmp/workspace')

    const sessions = useTerminalPanelStore.getState().removeOwner('chat:session-1')

    expect(sessions.map(session => session.id)).toEqual([
      'terminal:chat:session-1:1',
      'terminal:chat:session-1:2',
    ])
    expect(useTerminalPanelStore.getState().owners['chat:session-1']).toBeUndefined()
  })

  it('returns an empty cleanup list for an unknown owner', () => {
    expect(useTerminalPanelStore.getState().removeOwner('chat:missing')).toEqual([])
  })
})
