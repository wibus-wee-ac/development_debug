// Verifies BrowserPanel store tab shortcuts and render subscription boundaries.
import { act, cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
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
    cleanup()
    useBrowserPanelStore.setState({
      tabs: [],
      activeTabId: null,
      requestedTab: null,
      scrollToFilePath: null,
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

  it('stores session source metadata when creating a browser tab', () => {
    const tabId = useBrowserPanelStore.getState().createTab('https://example.com', {
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })

    expect(useBrowserPanelStore.getState().tabs.find(tab => tab.id === tabId)).toMatchObject({
      kind: 'browser',
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })
  })

  it('stores enabled script ids per browser tab', () => {
    const tabId = useBrowserPanelStore.getState().createTab('https://example.com')

    useBrowserPanelStore.getState().setBrowserTabScripts(tabId, ['react-scan', 'eruda'])

    expect(useBrowserPanelStore.getState().tabs.find(tab => tab.id === tabId)).toMatchObject({
      kind: 'browser',
      scriptIds: ['react-scan', 'eruda'],
    })
  })

  it('stores custom scripts per browser tab with insertion timing', () => {
    const tabId = useBrowserPanelStore.getState().createTab('https://example.com')

    const scriptId = useBrowserPanelStore.getState().addBrowserTabCustomScript(tabId, {
      label: 'Debug Hook',
      runAt: 'document-start',
      source: 'globalThis.__debugHook = true',
    })

    expect(useBrowserPanelStore.getState().tabs.find(tab => tab.id === tabId)).toMatchObject({
      kind: 'browser',
      customScripts: [{
        id: scriptId,
        label: 'Debug Hook',
        runAt: 'document-start',
        source: 'globalThis.__debugHook = true',
      }],
    })
  })

  it('preserves session source metadata when fulfilling a requested browser tab', () => {
    useBrowserPanelStore.getState().requestTab('https://example.com', {
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })
    const requestedTab = useBrowserPanelStore.getState().requestedTab

    expect(requestedTab).toMatchObject({
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })

    useBrowserPanelStore.getState().fulfillRequestedTab(requestedTab!.id)

    expect(useBrowserPanelStore.getState().tabs.at(-1)).toMatchObject({
      kind: 'browser',
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })
    expect(useBrowserPanelStore.getState().requestedTab).toBeNull()
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

  it('scopes file scroll requests to a workspace diff tab', () => {
    const tabId = useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })

    useBrowserPanelStore.getState().requestScrollToFilePath({
      path: 'src/index.ts',
      tabId,
    })

    expect(useBrowserPanelStore.getState().scrollToFilePath).toMatchObject({
      path: 'src/index.ts',
      tabId,
    })
  })

  it('does not notify tab subscribers for file scroll requests', () => {
    const tabId = useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })
    let renderCount = 0

    function TabsProbe() {
      useBrowserPanelStore(state => state.tabs)
      renderCount++
      return null
    }

    render(createElement(TabsProbe))
    expect(renderCount).toBe(1)

    act(() => {
      useBrowserPanelStore.getState().requestScrollToFilePath({
        path: 'src/index.ts',
        tabId,
      })
    })

    expect(renderCount).toBe(1)
  })

  it('does not notify store subscribers when reopening the active diff tab', () => {
    useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })
    const listener = vi.fn()
    const unsubscribe = useBrowserPanelStore.subscribe(listener)

    useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })

    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })
})
