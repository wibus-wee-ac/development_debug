/**
 * Browser Use Protocol — shared types and framing for Unix Domain Socket communication
 * between the MCP server (plugin) and the Browser Backend (Electron main).
 *
 * Wire format: 4-byte LE length prefix + UTF-8 JSON payload
 */

// ─── Command Types ──────────────────────────────────────────────────────────

export interface NavigateCommand {
  type: 'navigate'
  id: string
  url: string
  tabId?: string
}

export interface ScreenshotCommand {
  type: 'screenshot'
  id: string
  tabId?: string
  fullPage?: boolean
}

export interface ClickCommand {
  type: 'click'
  id: string
  tabId?: string
  selector: string
}

export interface TypeCommand {
  type: 'type'
  id: string
  tabId?: string
  selector: string
  text: string
}

export interface GetTextCommand {
  type: 'get_text'
  id: string
  tabId?: string
  selector?: string
}

export interface TabsListCommand {
  type: 'tabs_list'
  id: string
}

export interface TabsNewCommand {
  type: 'tabs_new'
  id: string
  url?: string
}

export interface TabsCloseCommand {
  type: 'tabs_close'
  id: string
  tabId: string
}

export interface EvalCommand {
  type: 'eval'
  id: string
  tabId?: string
  expression: string
}

export interface ScrollCommand {
  type: 'scroll'
  id: string
  tabId?: string
  selector?: string
  direction: 'up' | 'down' | 'left' | 'right'
  amount?: number
}

export interface HoverCommand {
  type: 'hover'
  id: string
  tabId?: string
  selector: string
}

export interface DomSnapshotCommand {
  type: 'dom_snapshot'
  id: string
  tabId?: string
}

export interface WaitForSelectorCommand {
  type: 'wait_for_selector'
  id: string
  tabId?: string
  selector: string
  timeout?: number
}

export interface KeyboardCommand {
  type: 'keyboard'
  id: string
  tabId?: string
  key: string
  modifiers?: string[]
}

export type BrowserCommand
  = | NavigateCommand
    | ScreenshotCommand
    | ClickCommand
    | TypeCommand
    | GetTextCommand
    | TabsListCommand
    | TabsNewCommand
    | TabsCloseCommand
    | EvalCommand
    | ScrollCommand
    | HoverCommand
    | DomSnapshotCommand
    | WaitForSelectorCommand
    | KeyboardCommand

// ─── Response Types ─────────────────────────────────────────────────────────

export interface SuccessResponse<T = unknown> {
  id: string
  ok: true
  data: T
}

export interface ErrorResponse {
  id: string
  ok: false
  error: string
}

export type BrowserResponse<T = unknown> = SuccessResponse<T> | ErrorResponse

// ─── Typed Response Data ────────────────────────────────────────────────────

export interface TabInfo {
  id: string
  url: string
  title: string
}

export type NavigateResult = { url: string, title: string }
export type ScreenshotResult = { base64: string, mimeType: 'image/png' }
export type ClickResult = { success: true }
export type TypeResult = { success: true }
export type GetTextResult = { text: string }
export type TabsListResult = { tabs: TabInfo[] }
export type TabsNewResult = { tab: TabInfo }
export type TabsCloseResult = { success: true }
export type EvalResult = { result: unknown }
export type ScrollResult = { success: true }
export type HoverResult = { success: true }
export interface AXNode { role: string, name: string, value?: string, description?: string, children?: AXNode[] }
export type DomSnapshotResult = { nodes: AXNode[] }
export type WaitForSelectorResult = { found: true }
export type KeyboardResult = { success: true }

// ─── Framing ────────────────────────────────────────────────────────────────

/** Encode a message into a framed buffer (4B LE length + UTF-8 JSON) */
export function encodeFrame(message: BrowserCommand | BrowserResponse): Buffer {
  const json = JSON.stringify(message)
  const payload = Buffer.from(json, 'utf-8')
  const frame = Buffer.alloc(4 + payload.length)
  frame.writeUInt32LE(payload.length, 0)
  payload.copy(frame, 4)
  return frame
}

/**
 * Frame decoder — accumulates chunks and yields complete messages.
 * Usage: call `push(chunk)` for each incoming data event.
 */
export class FrameDecoder {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer): Array<BrowserCommand | BrowserResponse> {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const messages: Array<BrowserCommand | BrowserResponse> = []

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (this.buffer.length < 4 + length) {
        break
      }
      const json = this.buffer.subarray(4, 4 + length).toString('utf-8')
      this.buffer = this.buffer.subarray(4 + length)
      messages.push(JSON.parse(json))
    }

    return messages
  }
}
