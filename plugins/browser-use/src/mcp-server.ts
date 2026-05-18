/**
 * Browser Use MCP Server
 *
 * Exposes browser control tools via MCP stdio protocol.
 * Connects to the Browser Backend (Electron main) via Unix Domain Socket.
 */

import { randomUUID } from 'node:crypto'
import type { Socket } from 'node:net'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import type { BrowserCommand, BrowserResponse } from './protocol.js'
import { encodeFrame, FrameDecoder } from './protocol.js'

// ─── Socket Client ──────────────────────────────────────────────────────────

class BrowserClient {
  private socket: Socket | null = null
  private decoder = new FrameDecoder()
  private pending = new Map<string, { resolve: (r: BrowserResponse) => void, reject: (e: Error) => void }>()
  private socketPath: string

  constructor(socketPath: string) {
    this.socketPath = socketPath
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = connect(this.socketPath)
      this.socket.on('connect', () => resolve())
      this.socket.on('error', err => reject(err))
      this.socket.on('data', (chunk) => {
        const messages = this.decoder.push(chunk)
        for (const msg of messages) {
          const response = msg as BrowserResponse
          const p = this.pending.get(response.id)
          if (p) {
            this.pending.delete(response.id)
            p.resolve(response)
          }
        }
      })
      this.socket.on('close', () => {
        // Reject all pending requests
        for (const [, p] of this.pending) {
          p.reject(new Error('Connection closed'))
        }
        this.pending.clear()
        this.socket = null
      })
    })
  }

  async send(cmd: Omit<BrowserCommand, 'id'> & Record<string, unknown>): Promise<BrowserResponse> {
    if (!this.socket) {
      await this.connect()
    }
    const id = randomUUID()
    const fullCmd = { ...cmd, id } as BrowserCommand

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket!.write(encodeFrame(fullCmd))

      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('Command timed out after 30s'))
        }
      }, 30_000)
    })
  }

  disconnect(): void {
    this.socket?.destroy()
    this.socket = null
  }
}

// ─── Socket Path Discovery ──────────────────────────────────────────────────

function discoverSocketPath(): string {
  // The socket lives in Electron's userData directory
  // On macOS: ~/Library/Application Support/Cradle/browser-backend.sock
  // On Linux: ~/.config/Cradle/browser-backend.sock
  // On Windows: %APPDATA%/Cradle/browser-backend.sock
  const platform = process.platform
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Cradle', 'browser-backend.sock')
  }
  if (platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Cradle', 'browser-backend.sock')
  }
  // Linux
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Cradle', 'browser-backend.sock')
}

// ─── MCP Server ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'browser-use',
  version: '0.0.1',
})

const client = new BrowserClient(process.env.BROWSER_BACKEND_SOCKET ?? discoverSocketPath())

// Tool: browser_navigate
server.registerTool(
  'browser_navigate',
  {
    description: 'Navigate the browser to a URL',
    inputSchema: { url: z.string().url().describe('The URL to navigate to'), tabId: z.string().optional().describe('Target tab ID') },
  },
  async ({ url, tabId }) => {
    const resp = await client.send({ type: 'navigate', url, tabId })
    if (!resp.ok) {
      return { content: [{ type: 'text', text: `Error: ${resp.error}` }], isError: true }
    }
    return { content: [{ type: 'text', text: `Navigated to ${(resp.data as { url: string }).url} — "${(resp.data as { title: string }).title}"` }] }
  },
)

// Tool: browser_screenshot
server.registerTool(
  'browser_screenshot',
  {
    description: 'Take a screenshot of the current page',
    inputSchema: { tabId: z.string().optional().describe('Target tab ID') },
  },
  async ({ tabId }) => {
    const resp = await client.send({ type: 'screenshot', tabId })
    if (!resp.ok) {
      return { content: [{ type: 'text', text: `Error: ${resp.error}` }], isError: true }
    }
    const data = resp.data as { base64: string, mimeType: string }
    return { content: [{ type: 'image', data: data.base64, mimeType: data.mimeType }] }
  },
)

// Tool: browser_click
server.registerTool(
  'browser_click',
  {
    description: 'Click an element on the page by CSS selector',
    inputSchema: { selector: z.string().describe('CSS selector of the element to click'), tabId: z.string().optional() },
  },
  async ({ selector, tabId }) => {
    const resp = await client.send({ type: 'click', selector, tabId })
    if (!resp.ok) {
      return { content: [{ type: 'text', text: `Error: ${resp.error}` }], isError: true }
    }
    return { content: [{ type: 'text', text: `Clicked: ${selector}` }] }
  },
)

// Tool: browser_type
server.registerTool(
  'browser_type',
  {
    description: 'Type text into an input element',
    inputSchema: {
      selector: z.string().describe('CSS selector of the input element'),
      text: z.string().describe('Text to type'),
      tabId: z.string().optional(),
    },
  },
  async ({ selector, text, tabId }) => {
    const resp = await client.send({ type: 'type', selector, text, tabId })
    if (!resp.ok) {
      return { content: [{ type: 'text', text: `Error: ${resp.error}` }], isError: true }
    }
    return { content: [{ type: 'text', text: `Typed "${text}" into ${selector}` }] }
  },
)

// Tool: browser_get_text
server.registerTool(
  'browser_get_text',
  {
    description: 'Get text content from the page or a specific element',
    inputSchema: { selector: z.string().optional().describe('CSS selector (omit for full page text)'), tabId: z.string().optional() },
  },
  async ({ selector, tabId }) => {
    const resp = await client.send({ type: 'get_text', selector, tabId })
    if (!resp.ok) {
      return { content: [{ type: 'text', text: `Error: ${resp.error}` }], isError: true }
    }
    return { content: [{ type: 'text', text: (resp.data as { text: string }).text }] }
  },
)

// Tool: browser_tabs_list
server.registerTool(
  'browser_tabs_list',
  {
    description: 'List all open browser tabs',
    inputSchema: {},
  },
  async () => {
    const resp = await client.send({ type: 'tabs_list' })
    if (!resp.ok) {
      return { content: [{ type: 'text', text: `Error: ${resp.error}` }], isError: true }
    }
    const { tabs } = resp.data as { tabs: Array<{ id: string, url: string, title: string }> }
    const text = tabs.map(t => `[${t.id}] ${t.title} — ${t.url}`).join('\n') || 'No tabs open'
    return { content: [{ type: 'text', text }] }
  },
)

// Tool: browser_eval
server.registerTool(
  'browser_eval',
  {
    description: 'Execute JavaScript in the browser page context',
    inputSchema: { expression: z.string().describe('JavaScript expression to evaluate'), tabId: z.string().optional() },
  },
  async ({ expression, tabId }) => {
    const resp = await client.send({ type: 'eval', expression, tabId })
    if (!resp.ok) {
      return { content: [{ type: 'text', text: `Error: ${resp.error}` }], isError: true }
    }
    const { result } = resp.data as { result: unknown }
    return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] }
  },
)

// Tool: browser_scroll
server.registerTool(
  'browser_scroll',
  {
    description: 'Scroll the page or a specific element in a direction',
    inputSchema: {
      direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction'),
      amount: z.number().optional().describe('Pixels to scroll, default 300'),
      selector: z.string().optional().describe('CSS selector of element to scroll within'),
      tabId: z.string().optional().describe('Target tab ID'),
    },
  },
  async ({ direction, amount, selector, tabId }) => {
    const resp = await client.send({ type: 'scroll', direction, amount, selector, tabId })
    if (!resp.ok) {
      return { content: [{ type: 'text', text: `Error: ${resp.error}` }], isError: true }
    }
    return { content: [{ type: 'text', text: `Scrolled ${direction}${amount ? ` ${amount}px` : ''}${selector ? ` within ${selector}` : ''}` }] }
  },
)

// Tool: browser_hover
server.registerTool(
  'browser_hover',
  {
    description: 'Hover over an element identified by CSS selector',
    inputSchema: {
      selector: z.string().describe('CSS selector of element to hover'),
      tabId: z.string().optional().describe('Target tab ID'),
    },
  },
  async ({ selector, tabId }) => {
    const resp = await client.send({ type: 'hover', selector, tabId })
    if (!resp.ok) {
      return { content: [{ type: 'text', text: `Error: ${resp.error}` }], isError: true }
    }
    return { content: [{ type: 'text', text: `Hovered: ${selector}` }] }
  },
)

// Tool: browser_dom_snapshot
server.registerTool(
  'browser_dom_snapshot',
  {
    description: 'Get the accessibility tree of the current page. Returns semantic nodes with roles and names, useful for understanding page structure without screenshots.',
    inputSchema: {
      tabId: z.string().optional().describe('Target tab ID'),
    },
  },
  async ({ tabId }) => {
    const resp = await client.send({ type: 'dom_snapshot', tabId })
    if (!resp.ok) {
      return { content: [{ type: 'text', text: `Error: ${resp.error}` }], isError: true }
    }
    const { nodes } = resp.data as { nodes: unknown[] }
    return { content: [{ type: 'text', text: JSON.stringify(nodes, null, 2) }] }
  },
)

// Tool: browser_wait_for_selector
server.registerTool(
  'browser_wait_for_selector',
  {
    description: 'Wait for an element matching a CSS selector to appear in the DOM',
    inputSchema: {
      selector: z.string().describe('CSS selector to wait for'),
      timeout: z.number().optional().describe('Max wait time in ms, default 5000'),
      tabId: z.string().optional().describe('Target tab ID'),
    },
  },
  async ({ selector, timeout, tabId }) => {
    const resp = await client.send({ type: 'wait_for_selector', selector, timeout, tabId })
    if (!resp.ok) {
      return { content: [{ type: 'text', text: `Error: ${resp.error}` }], isError: true }
    }
    return { content: [{ type: 'text', text: `Found: ${selector}` }] }
  },
)

// Tool: browser_keyboard
server.registerTool(
  'browser_keyboard',
  {
    description: 'Press a key or key combination (e.g., Enter, Escape, Ctrl+A)',
    inputSchema: {
      key: z.string().describe('Key to press (e.g., \'Enter\', \'Tab\', \'a\', \'Escape\')'),
      modifiers: z.array(z.string()).optional().describe('Modifier keys [\'ctrl\', \'alt\', \'shift\', \'meta\']'),
      tabId: z.string().optional().describe('Target tab ID'),
    },
  },
  async ({ key, modifiers, tabId }) => {
    const resp = await client.send({ type: 'keyboard', key, modifiers, tabId })
    if (!resp.ok) {
      return { content: [{ type: 'text', text: `Error: ${resp.error}` }], isError: true }
    }
    const combo = modifiers?.length ? `${modifiers.join('+')}+${key}` : key
    return { content: [{ type: 'text', text: `Pressed: ${combo}` }] }
  },
)

// ─── Start ──────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[browser-use] Fatal:', err)
  process.exit(1)
})
