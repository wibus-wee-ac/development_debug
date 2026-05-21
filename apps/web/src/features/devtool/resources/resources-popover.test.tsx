// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createResourceSnapshot, ResourcesPopover } from './resources-popover'

vi.mock('~/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('~/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}))

vi.mock('~/components/ui/progress', () => ({
  Progress: ({ value }: { value?: number | null }) => <div data-testid="mock-progress" data-value={value ?? 0} />,
}))

vi.mock('~/lib/electron', () => ({
  getServerUrl: () => 'http://server.test',
}))

function response(value: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: () => Promise.resolve(value),
  }
}

describe('resources popover snapshots', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('marks missing server and terminal endpoint data as warnings instead of silent zeroes', () => {
    const snapshot = createResourceSnapshot({
      renderer: {
        heapUsed: 32 * 1024 * 1024,
        heapTotal: 64 * 1024 * 1024,
        heapLimit: 128 * 1024 * 1024,
      },
      server: null,
      pty: null,
      chronicle: null,
      timestamp: 123,
    })

    expect(snapshot.serverRss).toBe(0)
    expect(snapshot.cliTuiRss).toBe(0)
    expect(snapshot.bottomPanelRss).toBe(0)
    expect(snapshot.warnings).toEqual([
      'Server metrics unavailable',
      'Terminal resource metrics unavailable',
    ])
  })

  it('renders a warning when an endpoint fails while another endpoint still resolves', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return Promise.resolve(response({}, false) as Response)
      }
      if (url.endsWith('/terminal-sessions/resources')) {
        return Promise.resolve(response({
          terminals: [],
          totals: {
            cliTuiRssMB: 12,
            bottomPanelRssMB: 4,
          },
          timestamp: 456,
        }) as Response)
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })

    render(<ResourcesPopover />)

    await waitFor(() => {
      expect(screen.getByTestId('resources-warning').textContent).toContain('Server metrics unavailable')
    })
    expect(screen.queryByText('Terminal resource metrics unavailable')).toBeNull()
    expect(screen.getByText('12 MB')).toBeTruthy()
  })

  it('exposes accessible labels for the trigger and refresh action', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return Promise.resolve(response({
          memory: {
            heapUsed: 10,
            heapTotal: 20,
            rss: 64,
            external: 2,
          },
          uptime: 90,
        }) as Response)
      }
      if (url.endsWith('/terminal-sessions/resources')) {
        return Promise.resolve(response({
          terminals: [],
          totals: {
            cliTuiRssMB: 12,
            bottomPanelRssMB: 4,
          },
          timestamp: 456,
        }) as Response)
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })

    render(<ResourcesPopover />)

    expect(screen.getByRole('button', { name: /resources:/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh resources' })).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /resources: 80 mb/i })).toBeTruthy()
    })
  })

  it('uses compact executable names for Windows-style terminal paths', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return Promise.resolve(response({
          memory: {
            heapUsed: 10,
            heapTotal: 20,
            rss: 64,
            external: 2,
          },
          uptime: 90,
        }) as Response)
      }
      if (url.endsWith('/terminal-sessions/resources')) {
        return Promise.resolve(response({
          terminals: [{
            id: 'terminal-1',
            role: 'bottom-panel',
            pid: 1234,
            executable: 'C:\\Program Files\\node\\node.exe',
            cwd: 'C:\\Project',
            running: true,
            startedAt: 456,
            cols: 120,
            rows: 30,
            rssMB: 42,
            descendantCount: 1,
          }],
          totals: {
            cliTuiRssMB: 0,
            bottomPanelRssMB: 42,
          },
          timestamp: 456,
        }) as Response)
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })

    render(<ResourcesPopover />)

    await waitFor(() => {
      expect(screen.getByText('node.exe')).toBeTruthy()
    })
    expect(screen.queryByText('C:\\Program Files\\node\\node.exe')).toBeNull()
  })
})
