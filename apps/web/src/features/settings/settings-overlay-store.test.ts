// Output: Regression tests for Settings overlay focus targets.
// Input: Settings overlay Zustand store mutations.
// Position: Settings feature-owned store contract coverage.

import { beforeEach, describe, expect, it } from 'vitest'

import { useSettingsOverlayStore } from './settings-overlay-store'

describe('settings overlay store', () => {
  beforeEach(() => {
    useSettingsOverlayStore.setState({
      settingsTabId: null,
      settingsSection: 'appearance',
      chronicleFocusTarget: null,
      agentFocusTarget: null,
    })
  })

  it('stores and clears Chronicle focus targets', () => {
    useSettingsOverlayStore.getState().setChronicleFocusTarget({ type: 'memory', id: 'memory-1' })

    expect(useSettingsOverlayStore.getState().chronicleFocusTarget).toEqual({
      type: 'memory',
      id: 'memory-1',
    })

    useSettingsOverlayStore.getState().clearChronicleFocusTarget()

    expect(useSettingsOverlayStore.getState().chronicleFocusTarget).toBeNull()
  })

  it('stores and clears Agent focus targets', () => {
    useSettingsOverlayStore.getState().setAgentFocusTarget({ id: 'agent-1' })

    expect(useSettingsOverlayStore.getState().agentFocusTarget).toEqual({ id: 'agent-1' })

    useSettingsOverlayStore.getState().clearAgentFocusTarget()

    expect(useSettingsOverlayStore.getState().agentFocusTarget).toBeNull()
  })
})
