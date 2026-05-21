import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDesktopTrayActionBridge } from './use-desktop-tray-action-bridge'

const mockedDeps = vi.hoisted(() => ({
  openTab: vi.fn(),
  setActiveTab: vi.fn(),
  openSettings: vi.fn(),
  setSettingsSection: vi.fn(),
  panels: [{ id: 'plugin:panel' }],
  tabState: {
    activeTabId: 'tab-home',
    tabs: [{ id: 'tab-home', type: 'home' }],
  },
}))

vi.mock('~/tabs/registry', () => ({
  useCradleTabStore: {
    getState: () => ({
      ...mockedDeps.tabState,
      openTab: mockedDeps.openTab,
      setActiveTab: mockedDeps.setActiveTab,
    }),
  },
}))

vi.mock('~/features/settings/settings-overlay-store', () => ({
  useSettingsOverlayStore: {
    getState: () => ({
      openSettings: mockedDeps.openSettings,
      setSettingsSection: mockedDeps.setSettingsSection,
    }),
  },
}))

vi.mock('~/lib/plugin-store', () => ({
  usePluginStore: {
    getState: () => ({
      panels: mockedDeps.panels,
    }),
  },
}))

function BridgeProbe({ onOpenGlobalSearch }: { onOpenGlobalSearch: () => void }) {
  useDesktopTrayActionBridge({ onOpenGlobalSearch })
  return null
}

describe('useDesktopTrayActionBridge', () => {
  const onOpenGlobalSearch = vi.fn()
  const onActionRequested = vi.fn()
  const consumePendingActionRequests = vi.fn()

  beforeEach(() => {
    mockedDeps.openTab.mockReset()
    mockedDeps.setActiveTab.mockReset()
    mockedDeps.openSettings.mockReset()
    mockedDeps.setSettingsSection.mockReset()
    onOpenGlobalSearch.mockReset()
    onActionRequested.mockReset()
    consumePendingActionRequests.mockReset()
    mockedDeps.tabState.activeTabId = 'tab-home'
    mockedDeps.tabState.tabs = [{ id: 'tab-home', type: 'home' }]
    mockedDeps.panels = [{ id: 'plugin:panel' }]

    onActionRequested.mockReturnValue(() => {})
    consumePendingActionRequests.mockResolvedValue([
      { actionId: 'open-chat', payload: { sessionId: 'session-1' } },
      { actionId: 'new-chat' },
      { actionId: 'global-search' },
      { actionId: 'open-approvals' },
      { actionId: 'open-awaits' },
      { actionId: 'open-automation' },
      { actionId: 'open-usage' },
      { actionId: 'open-desktop-settings' },
    ])

    Object.defineProperty(window, 'cradle', {
      configurable: true,
      value: {
        desktopTray: {
          consumePendingActionRequests,
          onActionRequested,
        },
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('subscribes before consuming pending requests and routes tray actions', async () => {
    render(<BridgeProbe onOpenGlobalSearch={onOpenGlobalSearch} />)

    await waitFor(() => {
      expect(onActionRequested).toHaveBeenCalled()
      expect(consumePendingActionRequests).toHaveBeenCalled()
      expect(onActionRequested).toHaveBeenCalledBefore(consumePendingActionRequests)
      expect(mockedDeps.openTab).toHaveBeenCalledWith('chat', { sessionId: 'session-1' })
      expect(mockedDeps.openTab).toHaveBeenCalledWith('new-chat', {})
      expect(mockedDeps.openTab).toHaveBeenCalledWith('approvals', {})
      expect(mockedDeps.openTab).toHaveBeenCalledWith('awaits', {})
      expect(mockedDeps.openTab).toHaveBeenCalledWith('automation', {})
      expect(mockedDeps.openTab).toHaveBeenCalledWith('usage', {})
      expect(onOpenGlobalSearch).toHaveBeenCalled()
      expect(mockedDeps.setActiveTab).toHaveBeenCalledWith('tab-home')
      expect(mockedDeps.setSettingsSection).toHaveBeenCalledWith('desktop')
      expect(mockedDeps.openSettings).toHaveBeenCalledWith('tab-home')
    })
  })

  it('routes plugin actions to the first plugin panel and falls back to skills settings', async () => {
    consumePendingActionRequests.mockResolvedValue([{ actionId: 'open-plugins' }])

    const { unmount } = render(<BridgeProbe onOpenGlobalSearch={onOpenGlobalSearch} />)

    await waitFor(() => {
      expect(mockedDeps.openTab).toHaveBeenCalledWith('plugin-panel', { panelId: 'plugin:panel' })
    })

    unmount()
    mockedDeps.openTab.mockReset()
    mockedDeps.setSettingsSection.mockReset()
    mockedDeps.openSettings.mockReset()
    mockedDeps.panels = []
    consumePendingActionRequests.mockResolvedValue([{ actionId: 'open-plugins' }])

    render(<BridgeProbe onOpenGlobalSearch={onOpenGlobalSearch} />)

    await waitFor(() => {
      expect(mockedDeps.setSettingsSection).toHaveBeenCalledWith('skills')
      expect(mockedDeps.openSettings).toHaveBeenCalledWith('tab-home')
    })
  })
})
