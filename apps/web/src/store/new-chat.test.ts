import { beforeEach, describe, expect, it } from 'vitest'

import { useNewChatStore } from './new-chat'

describe('useNewChatStore', () => {
  beforeEach(() => {
    useNewChatStore.setState({
      lastRuntimeKind: null,
      lastCliTuiAgentId: null,
      lastAgentProfileId: null,
      lastModelByProfile: {},
      lastThinkingEffort: null,
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

  it('does not notify subscribers when the selected runtime is already current', () => {
    const seenRuntimeKinds: Array<string | null> = []
    const unsubscribe = useNewChatStore.subscribe(state => seenRuntimeKinds.push(state.lastRuntimeKind))

    useNewChatStore.getState().setLastRuntimeKind('cli-tui')
    useNewChatStore.getState().setLastRuntimeKind('cli-tui')

    unsubscribe()

    expect(seenRuntimeKinds).toEqual(['cli-tui'])
  })

  it('does not notify subscribers when the selected CLI TUI agent is already current', () => {
    const seenAgentIds: Array<string | null> = []
    const unsubscribe = useNewChatStore.subscribe(state => seenAgentIds.push(state.lastCliTuiAgentId))

    useNewChatStore.getState().setLastCliTuiAgentId('agent-1')
    useNewChatStore.getState().setLastCliTuiAgentId('agent-1')

    unsubscribe()

    expect(seenAgentIds).toEqual(['agent-1'])
  })

  it('does not notify subscribers when the selected thinking effort is already current', () => {
    const seenThinkingEfforts: Array<string | null> = []
    const unsubscribe = useNewChatStore.subscribe(state => seenThinkingEfforts.push(state.lastThinkingEffort))

    useNewChatStore.getState().setLastThinkingEffort('medium')
    useNewChatStore.getState().setLastThinkingEffort('medium')

    unsubscribe()

    expect(seenThinkingEfforts).toEqual(['medium'])
  })

  it('reconciles removed profiles and prunes their stale model selections', () => {
    useNewChatStore.setState({
      lastRuntimeKind: 'standard',
      lastCliTuiAgentId: 'agent-1',
      lastAgentProfileId: 'profile-1',
      lastModelByProfile: {
        'profile-1': 'model-a',
        'profile-2': 'model-b',
      },
      lastThinkingEffort: 'high',
    })

    useNewChatStore.getState().reconcileProfiles(['profile-2'])

    expect(useNewChatStore.getState()).toMatchObject({
      lastRuntimeKind: 'standard',
      lastCliTuiAgentId: 'agent-1',
      lastAgentProfileId: null,
      lastModelByProfile: {
        'profile-2': 'model-b',
      },
      lastThinkingEffort: 'high',
    })
  })
})
