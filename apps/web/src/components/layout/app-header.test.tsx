// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppHeader } from './app-header'

const mockedDeps = vi.hoisted(() => ({
  layoutState: {
    bottomPanelOpen: true,
    asideOpen: false,
    asideActiveTab: 'files',
    sidebarCollapsed: false,
    browserPanelOpen: true,
    toggleBottomPanel: vi.fn(),
    toggleAside: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleBrowserPanel: vi.fn(),
  },
  tabState: {
    activeTabId: 'tab-chat',
    tabs: [{ id: 'tab-chat', type: 'chat' }],
  },
  settingsState: {
    settingsTabId: null as string | null,
  },
}))

vi.mock('@cradle/tabs-next', () => ({
  TabBar: () => <div data-testid="mock-tab-bar" />,
}))

vi.mock('~/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('~/features/devtool/resources/resources-popover', () => ({
  ResourcesPopover: () => <button type="button" aria-label="Resources: 12 MB">12 MB</button>,
}))

vi.mock('~/features/devtool/resources/resources-popover-loader', () => ({
  loadResourcesPopover: () => Promise.resolve({ default: () => <button type="button" aria-label="Resources: 12 MB">12 MB</button> }),
  preloadResourcesPopover: vi.fn(),
}))

vi.mock('~/features/browser/browser-panel-loader', () => ({
  preloadBrowserPanel: vi.fn(),
}))

vi.mock('~/features/tui/terminal-panel-view-loader', () => ({
  preloadTerminalPanelView: vi.fn(),
}))

vi.mock('~/features/workspace/file-tree-loader', () => ({
  preloadFileTree: vi.fn(),
}))

vi.mock('~/features/settings/settings-overlay-store', () => ({
  useSettingsOverlayStore: (selector: (state: typeof mockedDeps.settingsState) => unknown) => selector(mockedDeps.settingsState),
}))

vi.mock('~/lib/cn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('~/lib/electron', () => ({
  isElectron: true,
}))

vi.mock('~/lib/perf-monitor', () => ({
  markCradlePerformance: vi.fn(),
}))

vi.mock('~/store/layout', () => ({
  useLayoutStore: () => mockedDeps.layoutState,
}))

vi.mock('~/tabs/route-preload', () => ({
  preloadTabRoute: vi.fn(),
}))

vi.mock('~/tabs/registry', () => ({
  cradleRegistry: {},
  useCradleTabStore: (selector: (state: typeof mockedDeps.tabState) => unknown) => selector(mockedDeps.tabState),
}))

describe('AppHeader', () => {
  beforeEach(() => {
    mockedDeps.layoutState.bottomPanelOpen = true
    mockedDeps.layoutState.asideOpen = false
    mockedDeps.layoutState.sidebarCollapsed = false
    mockedDeps.layoutState.browserPanelOpen = true
    mockedDeps.tabState.activeTabId = 'tab-chat'
    mockedDeps.tabState.tabs = [{ id: 'tab-chat', type: 'chat' }]
    mockedDeps.settingsState.settingsTabId = null
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('exposes named AppHeader toggle controls and pressed states', () => {
    render(<AppHeader hasAside hasPanel />)

    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Toggle browser panel' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Toggle bottom panel' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Toggle right panel' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps AppHeader toggle callbacks wired through accessible controls', () => {
    render(<AppHeader hasAside hasPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle bottom panel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle right panel' }))

    expect(mockedDeps.layoutState.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(mockedDeps.layoutState.toggleBrowserPanel).toHaveBeenCalledTimes(1)
    expect(mockedDeps.layoutState.toggleBottomPanel).toHaveBeenCalledTimes(1)
    expect(mockedDeps.layoutState.toggleAside).toHaveBeenCalledTimes(1)
  })

  it('records bottom panel shell intent when opening the bottom panel', async () => {
    const { markCradlePerformance } = await import('~/lib/perf-monitor')
    const { preloadTerminalPanelView } = await import('~/features/tui/terminal-panel-view-loader')
    mockedDeps.layoutState.bottomPanelOpen = false

    render(<AppHeader hasPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle bottom panel' }))

    expect(preloadTerminalPanelView).toHaveBeenCalledTimes(1)
    expect(markCradlePerformance).toHaveBeenCalledWith('cradle:bottom-panel-shell-open-requested')
    expect(mockedDeps.layoutState.toggleBottomPanel).toHaveBeenCalledTimes(1)
  })

  it('records browser panel intent when opening the browser panel', async () => {
    const { markCradlePerformance } = await import('~/lib/perf-monitor')
    const { preloadBrowserPanel } = await import('~/features/browser/browser-panel-loader')
    mockedDeps.layoutState.browserPanelOpen = false

    render(<AppHeader />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }))

    expect(preloadBrowserPanel).toHaveBeenCalledTimes(1)
    expect(markCradlePerformance).toHaveBeenCalledWith('cradle:browser-panel-open-requested')
    expect(mockedDeps.layoutState.toggleBrowserPanel).toHaveBeenCalledTimes(1)
  })

  it('uses the expanded sidebar label when the sidebar is collapsed', () => {
    mockedDeps.layoutState.sidebarCollapsed = true

    render(<AppHeader />)

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy()
  })
})
