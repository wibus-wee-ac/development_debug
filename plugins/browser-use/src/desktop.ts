import { existsSync, unlinkSync } from 'node:fs'
import type { Server, Socket } from 'node:net'
import { createServer } from 'node:net'
import { join } from 'node:path'

import type { DesktopPluginContext } from '@cradle/plugin-sdk/desktop'

import {
  buildDocumentReadyExpression,
  buildElementClickExpression,
  buildEditableSelectionExpression,
  buildElementCenterExpression,
  buildFocusedEditableStateExpression,
  buildKeyboardTextFallbackExpression,
  buildScrollStateExpression,
  buildScrollWaitExpression,
  buildTextReplacementExpression,
  createKeyEventPayload,
  isRecoverableNavigationAbort,
} from './browser-commands.js'
import type {
  AXNode,
  BrowserCommand,
  BrowserResponse,
  ClickResult,
  DomSnapshotResult,
  EvalResult,
  GetTextResult,
  HoverResult,
  KeyboardResult,
  NavigateResult,
  ScreenshotResult,
  ScrollResult,
  TabInfo,
  TabsCloseResult,
  TabsListResult,
  TabsNewResult,
  TypeResult,
  WaitForSelectorResult,
} from './protocol.js'
import { encodeFrame, FrameDecoder } from './protocol.js'

let server: Server | null = null
let socketPath = ''

// eslint-disable-next-line ts/no-explicit-any -- Electron WebContents type, can't import electron in plugin
type WebContents = any

interface WebviewEntry {
  wc: WebContents
  attached: boolean
}

const webviewRegistry = new Map<string, WebviewEntry>()
const pendingWebviewResolvers: Array<(tabId: string) => void> = []
let tabCounter = 0

let desktopContext: DesktopPluginContext | null = null

async function waitForDocumentReady(entry: WebviewEntry): Promise<void> {
  ensureDebugger(entry)
  await entry.wc.debugger.sendCommand('Runtime.evaluate', {
    expression: buildDocumentReadyExpression(),
    awaitPromise: true,
    returnByValue: true,
  })
}

function ensureDebugger(entry: WebviewEntry): void {
  if (!entry.attached && !entry.wc.isDestroyed()) {
    try {
      entry.wc.debugger.attach('1.3')
      entry.attached = true
    }
    catch (err) {
      console.error('[browser-use] Failed to re-attach debugger:', err)
    }
  }
}

function getActiveWebview(): WebviewEntry | undefined {
  const entries = [...webviewRegistry.entries()]
  if (entries.length === 0) {
    return undefined
  }
  return entries.at(-1)![1]
}

function getWebview(tabId?: string): WebviewEntry | undefined {
  if (tabId) {
    const entry = webviewRegistry.get(tabId)
    if (entry && !entry.wc.isDestroyed()) {
      return entry
    }
    webviewRegistry.delete(tabId)
    return undefined
  }
  return getActiveWebview()
}

function registerWebview(wc: WebContents): string {
  const id = `tab-${++tabCounter}`
  let attached = false
  try {
    wc.debugger.attach('1.3')
    attached = true
  }
  catch (err) {
    console.error('[browser-use] Failed to attach debugger:', err)
  }

  const entry: WebviewEntry = { wc, attached }
  webviewRegistry.set(id, entry)

  wc.debugger.on('detach', (_event: unknown, reason: string) => {
    console.warn(`[browser-use] Debugger detached from ${id}: ${reason}`)
    entry.attached = false
  })

  wc.once('destroyed', () => {
    webviewRegistry.delete(id)
  })

  pendingWebviewResolvers.shift()?.(id)

  return id
}

async function requestRendererBrowserTab(url?: string): Promise<string> {
  if (!desktopContext) {
    throw new Error('Desktop plugin context is not available')
  }

  const before = new Set(webviewRegistry.keys())
  const created = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = pendingWebviewResolvers.indexOf(resolve)
      if (index >= 0) {
        pendingWebviewResolvers.splice(index, 1)
      }
      reject(new Error('Timed out waiting for renderer browser tab'))
    }, 5000)

    pendingWebviewResolvers.push((tabId) => {
      clearTimeout(timeout)
      resolve(tabId)
    })
  })

  await desktopContext.requestBrowserTab(url)

  for (const tabId of webviewRegistry.keys()) {
    if (!before.has(tabId)) {
      return tabId
    }
  }
  return created
}

async function handleCommand(cmd: BrowserCommand): Promise<BrowserResponse> {
  try {
    switch (cmd.type) {
      case 'navigate': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        try {
          await entry.wc.loadURL(cmd.url)
        }
        catch (err) {
          const finalUrl = entry.wc.getURL()
          if (!isRecoverableNavigationAbort(err, cmd.url, finalUrl)) {
            throw err
          }
        }
        await waitForDocumentReady(entry)
        const data: NavigateResult = { url: entry.wc.getURL(), title: entry.wc.getTitle() }
        return { id: cmd.id, ok: true, data }
      }

      case 'screenshot': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const result = await entry.wc.debugger.sendCommand('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: !!cmd.fullPage,
        })
        const data: ScreenshotResult = { base64: result.data, mimeType: 'image/png' }
        return { id: cmd.id, ok: true, data }
      }

      case 'click': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value: click } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: buildElementClickExpression(cmd.selector),
          returnByValue: true,
        })
        if (!click?.found) {
          throw new Error(`Element not found: ${cmd.selector}`)
        }
        const data: ClickResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'type': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value: replacement } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: buildTextReplacementExpression(cmd.selector, cmd.text),
          returnByValue: true,
        })
        if (!replacement?.found) {
          throw new Error(`Element not found: ${cmd.selector}`)
        }
        if (!replacement.editable) {
          throw new Error(`Element is not editable: ${cmd.selector}`)
        }
        const data: TypeResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'get_text': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: cmd.selector
            ? `document.querySelector(${JSON.stringify(cmd.selector)})?.innerText ?? ''`
            : `document.body.innerText`,
          returnByValue: true,
        })
        const data: GetTextResult = { text: value ?? '' }
        return { id: cmd.id, ok: true, data }
      }

      case 'scroll': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value: before } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: buildScrollStateExpression(cmd.selector),
          returnByValue: true,
        })
        if (!before?.found) {
          throw new Error(`Element not found: ${cmd.selector}`)
        }
        const amount = cmd.amount ?? 300
        const deltaX = cmd.direction === 'left' ? -amount : cmd.direction === 'right' ? amount : 0
        const deltaY = cmd.direction === 'up' ? -amount : cmd.direction === 'down' ? amount : 0
        await entry.wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: before.x,
          y: before.y,
          deltaX,
          deltaY,
        })
        const { result: { value: after } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: buildScrollWaitExpression(cmd.selector, cmd.direction, before),
          awaitPromise: true,
          returnByValue: true,
        })
        if (after?.canMove && !after.moved) {
          throw new Error(`Scroll did not move: ${cmd.direction}`)
        }
        const data: ScrollResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'hover': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value: box } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: buildElementCenterExpression(cmd.selector),
          returnByValue: true,
        })
        if (!box) {
          throw new Error(`Element not found: ${cmd.selector}`)
        }
        await entry.wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: box.x,
          y: box.y,
        })
        const data: HoverResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'dom_snapshot': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { nodes } = await entry.wc.debugger.sendCommand('Accessibility.getFullAXTree', {})
        const transformed: AXNode[] = nodes
          // eslint-disable-next-line ts/no-explicit-any
          .filter((n: any) => n.ignored !== true)
          // eslint-disable-next-line ts/no-explicit-any
          .map((n: any) => ({
            role: n.role?.value ?? 'unknown',
            name: n.name?.value ?? '',
            value: n.value?.value,
            description: n.description?.value,
          }))
        const data: DomSnapshotResult = { nodes: transformed }
        return { id: cmd.id, ok: true, data }
      }

      case 'wait_for_selector': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const timeout = cmd.timeout ?? 5000
        const start = Date.now()
        while (Date.now() - start < timeout) {
          const { result: { value } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
            expression: `!!document.querySelector(${JSON.stringify(cmd.selector)})`,
            returnByValue: true,
          })
          if (value) {
            break
          }
          await new Promise(r => setTimeout(r, 100))
        }
        const { result: { value: found } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: `!!document.querySelector(${JSON.stringify(cmd.selector)})`,
          returnByValue: true,
        })
        if (!found) {
          throw new Error(`Timeout waiting for selector: ${cmd.selector}`)
        }
        const data: WaitForSelectorResult = { found: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'keyboard': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value: before } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: buildFocusedEditableStateExpression(),
          returnByValue: true,
        })
        await entry.wc.debugger.sendCommand('Input.dispatchKeyEvent', createKeyEventPayload('keyDown', cmd.key, cmd.modifiers))
        await entry.wc.debugger.sendCommand('Input.dispatchKeyEvent', createKeyEventPayload('keyUp', cmd.key, cmd.modifiers))
        const { result: { value: after } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: buildFocusedEditableStateExpression(),
          returnByValue: true,
        })
        if (before?.editable && after?.editable && before.value === after.value) {
          await entry.wc.debugger.sendCommand('Runtime.evaluate', {
            expression: buildKeyboardTextFallbackExpression(cmd.key, cmd.modifiers),
            returnByValue: true,
          })
        }
        const data: KeyboardResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'tabs_list': {
        const tabs: TabInfo[] = []
        for (const [id, entry] of webviewRegistry) {
          if (entry.wc.isDestroyed()) {
            webviewRegistry.delete(id)
            continue
          }
          tabs.push({ id, url: entry.wc.getURL(), title: entry.wc.getTitle() })
        }
        const data: TabsListResult = { tabs }
        return { id: cmd.id, ok: true, data }
      }

      case 'tabs_new': {
        const newTabId = await requestRendererBrowserTab(cmd.url)
        const entry = getWebview(newTabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'New browser tab was not registered' }
        }
        if (cmd.url && entry.wc.getURL() !== cmd.url) {
          await entry.wc.loadURL(cmd.url)
        }
        if (cmd.url) {
          await waitForDocumentReady(entry)
        }
        const data: TabsNewResult = { tab: { id: newTabId, url: entry.wc.getURL(), title: entry.wc.getTitle() } }
        return { id: cmd.id, ok: true, data }
      }

      case 'tabs_close': {
        const entry = webviewRegistry.get(cmd.tabId)
        if (!entry || entry.wc.isDestroyed()) {
          webviewRegistry.delete(cmd.tabId)
          return { id: cmd.id, ok: false, error: `Tab ${cmd.tabId} not found` }
        }
        try {
          entry.wc.debugger.detach()
        }
        catch { /* already detached */ }
        entry.wc.close()
        webviewRegistry.delete(cmd.tabId)
        const data: TabsCloseResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'eval': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: cmd.expression,
          returnByValue: true,
        })
        const data: EvalResult = { result: value }
        return { id: cmd.id, ok: true, data }
      }

      default:
        return { id: (cmd as BrowserCommand).id, ok: false, error: `Unknown command type` }
    }
  }
  catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function handleConnection(socket: Socket): void {
  const decoder = new FrameDecoder()
  socket.on('data', (chunk: Buffer) => {
    const messages = decoder.push(chunk)
    for (const msg of messages) {
      handleCommand(msg as BrowserCommand).then((response) => {
        socket.write(encodeFrame(response))
      })
    }
  })
  socket.on('error', () => {})
}

export function activate(ctx: DesktopPluginContext): void {
  desktopContext = ctx
  socketPath = join(ctx.userDataPath, 'browser-backend.sock')

  // Clean up stale socket
  if (existsSync(socketPath)) {
    unlinkSync(socketPath)
  }

  // Start socket server
  server = createServer(handleConnection)
  server.listen(socketPath)
  server.on('error', (err) => {
    ctx.logger.error('Socket server error:', err)
  })

  // Propagate socket path to server via shared config
  ctx.setSharedConfig('BROWSER_BACKEND_SOCKET', socketPath)

  // Listen for webview creation
  ctx.onWebviewCreated((wc, _tabId) => {
    registerWebview(wc)
  })

  ctx.logger.info(`Browser backend started on ${socketPath}`)
}

export function deactivate(): void {
  desktopContext = null
  pendingWebviewResolvers.splice(0)
  // Detach all debuggers
  for (const [, entry] of webviewRegistry) {
    if (entry.attached && !entry.wc.isDestroyed()) {
      try {
        entry.wc.debugger.detach()
      }
      catch { /* ignore */ }
    }
  }
  webviewRegistry.clear()

  if (server) {
    server.close()
    server = null
  }
  if (socketPath && existsSync(socketPath)) {
    unlinkSync(socketPath)
  }
}
