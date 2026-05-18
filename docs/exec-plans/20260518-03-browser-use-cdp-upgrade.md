# Browser Use Plugin: CDP Upgrade

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

Maintained in accordance with docs/exec-plans conventions.

## Purpose / Big Picture

After this change, the Cradle Claude Agent can interact with the in-app browser at the level of real browser input events — clicks dispatch actual mouse events (not simulated JS .click()), keystrokes arrive through the Input domain, and the agent can obtain a DOM accessibility snapshot to understand page structure without screenshots. This brings the plugin from a toy (executeJavaScript-based) implementation to production-grade browser automation comparable to Codex IAB.

The user can verify the upgrade by chatting with Claude Agent in Cradle desktop, asking it to navigate to a page, and observing that actions like clicking, typing, and reading page content work correctly even on pages with strict CSP or event handler interception.

## Progress

- [x] (2025-05-18 05:00Z) V1 Plugin created — MCP server + socket backend + protocol + build + integration
- [x] (2025-05-18 05:15Z) Upgrade protocol.ts — added 5 new command types (scroll, hover, dom_snapshot, wait_for_selector, keyboard) + result types
- [x] (2025-05-18 05:15Z) Rewrite browser-backend.ts — CDP via webContents.debugger (Input.dispatchMouseEvent, Input.dispatchKeyEvent, Runtime.evaluate, Accessibility.getFullAXTree, Page.captureScreenshot)
- [x] (2025-05-18 05:15Z) Expand MCP server tools — 12 total tools (7 original + 5 new)
- [x] (2025-05-18 05:16Z) Build verification: plugin builds (719KB), desktop typecheck clean, server typecheck clean

## Surprises & Discoveries

(none yet)

## Decision Log

- Decision: Use `webContents.debugger.attach('1.3')` for CDP session rather than spawning a separate CDP target.
  Rationale: Electron's debugger API gives direct CDP access to the webview's DevTools protocol without extra process overhead. Protocol version 1.3 covers all domains we need (Page, Runtime, Input, DOM, DOMSnapshot, Accessibility).
  Date: 2025-05-18

- Decision: Keep `executeJavaScript` for eval command only; all interaction commands move to CDP Input/DOM.
  Rationale: eval is inherently a JS execution tool. But click/type/scroll should use real input events for reliability.
  Date: 2025-05-18

- Decision: Add `dom_snapshot` command using `Accessibility.getFullAXTree` rather than `DOMSnapshot.captureSnapshot`.
  Rationale: Accessibility tree is what AI agents (Claude, etc.) work with best — concise, semantic, filterable. DOM snapshot is enormous and mostly noise.
  Date: 2025-05-18

## Outcomes & Retrospective

Complete. The browser backend now uses CDP for all interaction commands:
- **Input events**: click, hover, scroll use `Input.dispatchMouseEvent`; type uses `Input.insertText`; keyboard uses `Input.dispatchKeyEvent`
- **Screenshots**: `Page.captureScreenshot` with fullPage support
- **DOM inspection**: `Accessibility.getFullAXTree` for semantic page understanding
- **Evaluation**: `Runtime.evaluate` for getText, eval, waitForSelector
- **Navigation**: `loadURL` (Electron API, correct for webview)

The MCP server exposes 12 tools total, giving Claude Agent comprehensive browser automation within the Cradle desktop app.

## Context and Orientation

The Browser Use plugin lives at `plugins/browser-use/` and consists of:

1. `src/protocol.ts` — TypeScript types for commands/responses + binary framing (4B LE length + JSON)
2. `src/mcp-server.ts` — MCP stdio server exposing tools to Claude Agent SDK
3. `vite.config.ts` — Build config producing `dist/mcp-server.mjs`

The Electron backend is at `apps/desktop/src/main/browser-backend.ts` and handles incoming socket commands by operating on webview `WebContents` instances registered via `registerWebview()`.

The integration point is in `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts` which injects the MCP server config when `BROWSER_BACKEND_SOCKET` env var is present.

Key Electron API for this upgrade: `webContents.debugger` — attach, sendCommand, detach, event. This gives raw Chrome DevTools Protocol access to the webview.

## Plan of Work

### Milestone 1: Protocol Expansion

Expand `plugins/browser-use/src/protocol.ts` with new command types:

- `ScrollCommand` — { type: 'scroll', direction: 'up'|'down'|'left'|'right', amount?: number, selector?: string, tabId? }
- `HoverCommand` — { type: 'hover', selector: string, tabId? }
- `DomSnapshotCommand` — { type: 'dom_snapshot', tabId? }
- `WaitForSelectorCommand` — { type: 'wait_for_selector', selector: string, timeout?: number, tabId? }
- `KeyboardCommand` — { type: 'keyboard', key: string, modifiers?: string[], tabId? }

Add result types: `ScrollResult`, `HoverResult`, `DomSnapshotResult` (nodes array), `WaitForSelectorResult`, `KeyboardResult`.

Update the `BrowserCommand` union type.

### Milestone 2: CDP-Based Browser Backend

Rewrite `apps/desktop/src/main/browser-backend.ts`:

1. On `registerWebview(wc)`, call `wc.debugger.attach('1.3')` to open CDP session
2. Replace all command handlers:
   - **navigate**: Keep `loadURL` (it's fine) but add `Page.loadEventFired` wait
   - **screenshot**: Use `Page.captureScreenshot` via CDP (supports fullPage, clip, format options)
   - **click**: Use `Runtime.evaluate` to find element bounds via selector → `Input.dispatchMouseEvent` (mousePressed + mouseReleased)
   - **type**: Use `Input.insertText` or per-char `Input.dispatchKeyEvent`
   - **get_text**: Use `Runtime.evaluate` (this is fine as-is)
   - **scroll**: Use `Input.dispatchMouseEvent` with type 'mouseWheel'
   - **hover**: Use element bounds → `Input.dispatchMouseEvent` type 'mouseMoved'
   - **dom_snapshot**: Use `Accessibility.getFullAXTree` and flatten to useful structure
   - **wait_for_selector**: Use `Runtime.evaluate` with polling
   - **keyboard**: Use `Input.dispatchKeyEvent`

3. Handle debugger detach gracefully (re-attach if needed)

### Milestone 3: MCP Server Tool Expansion

Add new tools to `plugins/browser-use/src/mcp-server.ts`:

- `browser_scroll` — scroll page or element
- `browser_hover` — hover over element
- `browser_dom_snapshot` — get accessibility tree
- `browser_wait_for_selector` — wait for element to appear
- `browser_keyboard` — press key combinations

### Milestone 4: Build & Verify

- `pnpm --filter @cradle/browser-use build`
- `pnpm --filter @cradle/desktop typecheck`
- `npx tsc --noEmit` in apps/server

## Concrete Steps

Working directory: `/Users/wibus/dev/Cradle`

1. Edit `plugins/browser-use/src/protocol.ts` — add 5 new command interfaces + result types + update union
2. Edit `apps/desktop/src/main/browser-backend.ts` — CDP debugger attach + rewrite handlers
3. Edit `plugins/browser-use/src/mcp-server.ts` — add 5 new tools
4. Run: `pnpm --filter @cradle/browser-use build` — expect clean build
5. Run: `pnpm --filter @cradle/desktop typecheck` — expect no errors
6. Run: `cd apps/server && npx tsc --noEmit` — expect no errors

## Validation and Acceptance

After the upgrade:
1. `pnpm --filter @cradle/browser-use build` produces `dist/mcp-server.mjs` without errors
2. Desktop typecheck passes (CDP API usage is correct)
3. Server typecheck passes (no regression from provider integration)
4. The MCP server, when started with a valid socket, exposes 12 tools (7 original + 5 new)

## Idempotence and Recovery

All changes are to existing files that are version-controlled. If any step fails, revert the file and retry. The plugin can always fall back to the V1 executeJavaScript implementation by reverting browser-backend.ts.

## Artifacts and Notes

Electron `webContents.debugger` API reference:
- `debugger.attach(protocolVersion)` — attaches debugger
- `debugger.sendCommand(method, params?)` — sends CDP command, returns Promise
- `debugger.detach()` — detaches debugger
- `debugger.on('message', handler)` — CDP events
- `debugger.on('detach', handler)` — debugger was detached

Key CDP domains:
- `Input.dispatchMouseEvent` — type: 'mousePressed'|'mouseReleased'|'mouseMoved'|'mouseWheel', x, y, button, clickCount, deltaX, deltaY
- `Input.dispatchKeyEvent` — type: 'keyDown'|'keyUp'|'char', key, code, text, windowsVirtualKeyCode
- `Input.insertText` — text (for bulk text input)
- `Page.captureScreenshot` — format, quality, clip, fromSurface, captureBeyondViewport
- `Runtime.evaluate` — expression, returnByValue, awaitPromise
- `Accessibility.getFullAXTree` — returns full accessibility tree

## Interfaces and Dependencies

In `plugins/browser-use/src/protocol.ts`, add:

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

    export type ScrollResult = { success: true }
    export type HoverResult = { success: true }
    export interface AXNode { role: string; name: string; value?: string; description?: string; children?: AXNode[] }
    export type DomSnapshotResult = { nodes: AXNode[] }
    export type WaitForSelectorResult = { found: true }
    export type KeyboardResult = { success: true }
