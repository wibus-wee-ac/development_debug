import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  handleBrowserPanelTabShortcut,
  handleBrowserPanelTabShortcutPayload,
  useBrowserPanelStore,
} from './browser-panel'

function commandKeyEvent(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: true,
  })
  vi.spyOn(event, 'preventDefault')
  vi.spyOn(event, 'stopPropagation')
  vi.spyOn(event, 'stopImmediatePropagation')
  return event
}

describe('browser panel shortcuts', () => {
  beforeEach(() => {
    useBrowserPanelStore.setState({
      tabs: [],
      activeTabId: null,
      requestedTab: null,
    })
  })

  it('closes the active browser panel tab on command W', () => {
    const firstTabId = useBrowserPanelStore.getState().createTab('https://example.com')
    const secondTabId = useBrowserPanelStore.getState().createTab('https://openai.com')
    const event = commandKeyEvent('w')

    expect(handleBrowserPanelTabShortcut(event, { panelOpen: true })).toBe(true)

    const state = useBrowserPanelStore.getState()
    expect(state.tabs.map(tab => tab.id)).toEqual([firstTabId])
    expect(state.activeTabId).toBe(firstTabId)
    expect(state.tabs.some(tab => tab.id === secondTabId)).toBe(false)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
  })

  it('switches browser panel tabs on command number', () => {
    const firstTabId = useBrowserPanelStore.getState().createTab('https://example.com')
    useBrowserPanelStore.getState().createTab('https://openai.com')
    const event = commandKeyEvent('1')

    expect(handleBrowserPanelTabShortcut(event, { panelOpen: true })).toBe(true)

    expect(useBrowserPanelStore.getState().activeTabId).toBe(firstTabId)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
  })

  it('handles forwarded webview command W payloads', () => {
    useBrowserPanelStore.getState().createTab('https://example.com')

    expect(handleBrowserPanelTabShortcutPayload({
      key: 'w',
      metaKey: true,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
    }, { panelOpen: true })).toBe(true)

    expect(useBrowserPanelStore.getState().tabs).toHaveLength(0)
  })

  it('does not consume shortcuts when the browser panel is closed', () => {
    useBrowserPanelStore.getState().createTab('https://example.com')
    const event = commandKeyEvent('w')

    expect(handleBrowserPanelTabShortcut(event, { panelOpen: false })).toBe(false)

    expect(useBrowserPanelStore.getState().tabs).toHaveLength(1)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not consume shortcuts when a workspace file tab is active', () => {
    useBrowserPanelStore.getState().openWorkspaceFileTab({
      workspaceId: 'workspace-1',
      path: 'src/index.ts',
      view: 'preview',
    })
    const event = commandKeyEvent('w')

    expect(handleBrowserPanelTabShortcut(event, { panelOpen: true })).toBe(false)

    expect(useBrowserPanelStore.getState().tabs).toHaveLength(1)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
