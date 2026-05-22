import { describe, expect, it } from 'vitest'

import { useSettingsOverlayStore } from './settings-overlay-store'

describe('useSettingsOverlayStore', () => {
  it('tracks and clears Chronicle focus targets', () => {
    useSettingsOverlayStore.setState({ chronicleFocusTarget: null })

    useSettingsOverlayStore.getState().setChronicleFocusTarget({
      type: 'knowledge',
      id: 'knowledge-1',
    })

    expect(useSettingsOverlayStore.getState().chronicleFocusTarget).toEqual({
      type: 'knowledge',
      id: 'knowledge-1',
    })

    useSettingsOverlayStore.getState().clearChronicleFocusTarget()

    expect(useSettingsOverlayStore.getState().chronicleFocusTarget).toBeNull()
  })
})
