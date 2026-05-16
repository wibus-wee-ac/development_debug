// Input: Vitest helpers and the session activity Zustand store
// Output: Regression tests for unread ownership and visible-session reconciliation
// Position: Renderer store unit test for session activity semantics

import { beforeEach, describe, expect, it } from 'vitest'

import { useSessionActivityStore } from './session-activity'

describe('useSessionActivityStore', () => {
  beforeEach(() => {
    useSessionActivityStore.setState({
      unread: new Set<string>(),
      visibleSessionId: null,
    })
  })

  it('marks background session activity as unread', () => {
    useSessionActivityStore.getState().setVisibleSession('session-visible')

    useSessionActivityStore.getState().recordActivity('session-background')

    expect(useSessionActivityStore.getState().unread).toEqual(new Set(['session-background']))
  })

  it('does not mark the currently visible session as unread', () => {
    useSessionActivityStore.getState().setVisibleSession('session-visible')

    useSessionActivityStore.getState().recordActivity('session-visible')

    expect(useSessionActivityStore.getState().unread).toEqual(new Set())
  })

  it('clears unread state when a session becomes visible', () => {
    useSessionActivityStore.getState().recordActivity('session-background')

    useSessionActivityStore.getState().setVisibleSession('session-background')

    expect(useSessionActivityStore.getState()).toMatchObject({
      visibleSessionId: 'session-background',
    })
    expect(useSessionActivityStore.getState().unread).toEqual(new Set())
  })
})