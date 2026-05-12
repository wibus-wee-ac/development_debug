// Input: Vitest helpers and the new-chat Zustand store
// Output: Regression tests for idempotent new-chat preference updates
// Position: Renderer store unit test for new-chat persisted preferences

import { beforeEach, describe, expect, it } from 'vitest'

import { useNewChatStore } from './new-chat'

describe('useNewChatStore', () => {
  beforeEach(() => {
    useNewChatStore.setState({
      lastAgentProfileId: null,
      lastModelByProfile: {},
    })
  })

  it('does not notify subscribers when the selected profile is already current', () => {
    const seenProfileIds: Array<string | null> = []
    const unsubscribe = useNewChatStore.subscribe(state => seenProfileIds.push(state.lastAgentProfileId))

    useNewChatStore.getState().setLastAgentProfileId('profile-1')
    useNewChatStore.getState().setLastAgentProfileId('profile-1')

    unsubscribe()

    expect(seenProfileIds).toEqual(['profile-1'])
  })

  it('does not notify subscribers when the selected model is already current', () => {
    const seenModelIds: Array<string | undefined> = []
    const unsubscribe = useNewChatStore.subscribe(state => seenModelIds.push(state.lastModelByProfile['profile-1']))

    useNewChatStore.getState().setLastModelForProfile('profile-1', 'model-1')
    useNewChatStore.getState().setLastModelForProfile('profile-1', 'model-1')

    unsubscribe()

    expect(seenModelIds).toEqual(['model-1'])
  })

  it('reconciles removed profiles and prunes their stale model selections', () => {
    useNewChatStore.setState({
      lastAgentProfileId: 'profile-1',
      lastModelByProfile: {
        'profile-1': 'model-a',
        'profile-2': 'model-b',
      },
    })

    useNewChatStore.getState().reconcileProfiles(['profile-2'])

    expect(useNewChatStore.getState()).toMatchObject({
      lastAgentProfileId: null,
      lastModelByProfile: {
        'profile-2': 'model-b',
      },
    })
  })
})
