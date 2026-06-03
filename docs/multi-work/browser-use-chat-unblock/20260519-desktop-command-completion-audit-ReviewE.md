# ReviewE: Desktop Command Completion Audit

Date: 2026-05-19
Scope: code review only, with no source edits except this handoff file.

## Direct Conclusion

当前实现已经明显超过 ReviewC 时的状态：`browser_tabs_new` 现在会请求 renderer 创建真实 BrowserPanel tab，desktop backend 会等待新 webview 注册，screenshot 会先激活目标 renderer tab，MCP tool coverage 也覆盖了本次 unblock 需要的导航、点击、输入、滚动、文本读取、截图、AX snapshot、等待 selector、键盘和 tab lifecycle。

但我不建议把它标记为“100% unblock 已被验证”。剩余缺口主要不在 command helper 本身，而在 tab/active semantics 和 validation：

1. 未看到覆盖 `requestBrowserTab` / `activateBrowserTab` / `tabs_new` / screenshot activation 的自动化测试。
2. 默认 active webview 仍是 registry insertion order，不是 renderer active tab；UI 切换 active tab 后，无 `tabId` 命令可能控制错误 tab。
3. `requestBrowserTab()` 的 fallback IPC path 不可等待，若 global bridge 尚未注册或目标 window 不是 Chat route，会返回 `undefined`，而 desktop backend 仍等待 webview attach 直到 timeout。
4. ExecPlan 记录了 desktop smoke transcript，但当前代码里没有可重复 smoke harness；这对“用户 100% unblock”仍是风险。

## Evidence

### Implemented: MCP `tabs_new` can create a real renderer tab

- `plugins/browser-use/src/desktop.ts:153-190` defines `requestRendererBrowserTab()`: captures existing backend tabs, calls `desktopContext.requestBrowserTab(url)`, waits for a newly registered webview, and maps `entry.rendererTabId = rendererTabId`.
- `plugins/browser-use/src/desktop.ts:411-424` handles `tabs_new` by calling `requestRendererBrowserTab(cmd.url)` and returns the new backend `tab-*` id.
- `apps/desktop/src/main/plugin-loader.ts:175-193` implements `requestBrowserTab(url)` by executing `globalThis.__cradleBrowserUseCreateTab(url)` in a renderer window, then falling back to `window.webContents.send('browser-use:create-tab', { url })`.
- `apps/web/src/components/layout/app-layout.tsx:91-129` registers `window.__cradleBrowserUseCreateTab`, `window.__cradleBrowserUseActivateTab`, and the `browser-use:create-tab` IPC listener. `createBrowserTab()` opens the panel and calls `useBrowserPanelStore.getState().createTab(url)`.
- `apps/web/src/store/browser-panel.ts:49-56` creates renderer tab ids (`bt-*`) and sets the new tab active.
- `apps/web/src/features/browser/browser-panel.tsx:308-317` renders one `<webview>` per renderer tab, which is what triggers Electron webview registration.

This closes the main ReviewC blocker that `browser_tabs_new` only reused the latest webview.

### Implemented: hidden webview screenshot has an activation path

- `plugins/browser-use/src/desktop.ts:83-91` calls `desktopContext.activateBrowserTab(entry.rendererTabId)` and waits briefly after activation.
- `plugins/browser-use/src/desktop.ts:215-223` invokes that activation before `entry.wc.capturePage()` and wraps capture in a 3000ms timeout.
- `apps/desktop/src/main/plugin-loader.ts:194-209` executes `globalThis.__cradleBrowserUseActivateTab(tabId)` in the renderer.
- `apps/web/src/components/layout/app-layout.tsx:106-114` validates the renderer tab exists, opens the browser panel, sets that tab active, and returns `true`.
- `apps/web/src/features/browser/browser-panel.tsx:50-58` keeps inactive webviews mounted with `display: none`, so activation is relevant for screenshots of previously hidden tabs.

The implementation is directionally correct for the known hidden-webview hang. Missing piece: there is no automated or checked-in smoke test that asserts hidden tab screenshot succeeds after creating two tabs and capturing the inactive one.

### Implemented: low-level command semantics are stronger than the original failures

- Navigation: `plugins/browser-use/src/desktop.ts:201-212` treats `loadURL` errors as recoverable only via `isRecoverableNavigationAbort()`, then waits for document readiness.
- URL abort classification: `plugins/browser-use/src/browser-commands.ts:140-167` requires `ERR_ABORTED` and equivalent final URL.
- Type: `plugins/browser-use/src/desktop.ts:243-260` uses `buildTextReplacementExpression()` rather than Ctrl+A/Backspace.
- Text replacement: `plugins/browser-use/src/browser-commands.ts:249-275` directly updates input/textarea/contenteditable values and dispatches input/change events.
- Keyboard: `plugins/browser-use/src/desktop.ts:372-395` dispatches full CDP keyDown/keyUp payloads and applies a text fallback if an editable focused element did not change.
- Key payloads: `plugins/browser-use/src/browser-commands.ts:78-138` maps modifier aliases and common key codes.
- Scroll: `plugins/browser-use/src/desktop.ts:279-297` uses `buildScrollActionExpression()` and errors when a scrollable target did not move.
- Scroll movement: `plugins/browser-use/src/browser-commands.ts:372-441` reads before/after page or element scroll offsets.

One nuance: the ExecPlan originally says type should select then `Input.insertText`; the current implementation directly mutates DOM values and dispatches DOM events. That is probably more reliable for React-style controlled inputs than the old macOS Ctrl+A path, but it is not the exact lower-level input-event path described in the plan.

### Implemented: MCP tool coverage is broad enough for the acceptance surface

`plugins/browser-use/src/mcp-server.ts` registers:

- `browser_navigate`: lines 114-128.
- `browser_screenshot`: lines 130-145.
- `browser_click`: lines 147-161.
- `browser_type`: lines 163-181.
- `browser_get_text`: lines 183-197.
- `browser_tabs_list`: lines 199-215.
- `browser_eval`: lines 217-232.
- `browser_scroll`: lines 234-253.
- `browser_hover`: lines 255-272.
- `browser_dom_snapshot`: lines 274-291.
- `browser_wait_for_selector`: lines 293-311.
- `browser_keyboard`: lines 313-332.

Gap: I did not find a `browser_tabs_new` or `browser_tabs_close` MCP tool in this file, even though protocol and desktop backend implement `tabs_new` / `tabs_close` (`plugins/browser-use/src/protocol.ts:51-61`, `plugins/browser-use/src/desktop.ts:411-440`). If the model only reaches the backend through MCP, then tab creation is not exposed as a tool despite being implemented in the socket protocol.

### Implemented: focused helper and protocol tests exist

- `vitest.config.ts:16-29` includes `plugins/**/*.test.ts`, so plugin tests are discoverable.
- `plugins/browser-use/src/browser-commands.test.ts:13-80` covers modifier mask, key payloads, recoverable navigation aborts, URL equivalence, editable selection expression, and document readiness expression.
- `plugins/browser-use/src/protocol.test.ts:6-31` covers complete, split, and multi-frame protocol decoding.
- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.test.ts:86-136` asserts plugin-registered `browser-use` MCP config, including `BROWSER_BACKEND_SOCKET`, reaches Claude Agent SDK query options.

Gap: these tests do not cover renderer tab creation, backend tab mapping, active tab switching, hidden tab screenshot activation, MCP tab tools, or command-level `tabs_new`.

## Remaining Functional Gaps

### Gap A: MCP tab lifecycle coverage appears incomplete

Severity: high for “model can self-start browser work”.

Evidence:

- Protocol supports `tabs_new` and `tabs_close`: `plugins/browser-use/src/protocol.ts:51-61`.
- Desktop backend implements them: `plugins/browser-use/src/desktop.ts:411-440`.
- MCP server exposes only list, not new/close: `plugins/browser-use/src/mcp-server.ts:199-215` for `browser_tabs_list`; no `browser_tabs_new` / `browser_tabs_close` registration appears in `plugins/browser-use/src/mcp-server.ts:114-332`.

Concrete missing work:

- Add MCP tools for `browser_tabs_new` and `browser_tabs_close`, or document that Chat must never create/close tabs through MCP.
- Add a test or smoke transcript proving a Claude Agent MCP call can create a visible BrowserPanel tab, not only a direct socket command.

### Gap B: default active tab semantics still do not track renderer active tab

Severity: high for multi-tab reliability.

Evidence:

- `plugins/browser-use/src/desktop.ts:105-111` defines active backend webview as the last entry in `webviewRegistry`.
- `plugins/browser-use/src/desktop.ts:113-123` uses that insertion-order active webview whenever a command omits `tabId`.
- Renderer tab switching only calls `setActiveTab(tab.id)` in UI state: `apps/web/src/features/browser/browser-panel.tsx:224-235` and `apps/web/src/store/browser-panel.ts:86-88`.
- There is no call from renderer active-tab changes back to desktop backend, and `ctx.onWebviewCreated((wc, _tabId) => registerWebview(wc))` ignores the renderer tab id supplied by the host at `plugins/browser-use/src/desktop.ts:499-500`.

Concrete missing work:

- Either make every MCP command require `tabId` after multiple tabs exist, or add a renderer-to-desktop active-tab signal and map renderer `bt-*` ids to backend `tab-*` ids.
- Add a smoke/test case: create two tabs, switch visible active tab to the first, call `browser_get_text` without `tabId`, and prove it reads the visible tab.

### Gap C: fallback tab creation is not observable by the caller

Severity: medium-high.

Evidence:

- `apps/desktop/src/main/plugin-loader.ts:182-193` returns a string only if `__cradleBrowserUseCreateTab()` exists. Otherwise it sends `browser-use:create-tab` and returns `undefined`.
- `plugins/browser-use/src/desktop.ts:174-190` assigns `rendererTabId = await desktopContext.requestBrowserTab(url)` and then waits for webview registration. If the fallback IPC path is used, `rendererTabId` remains `undefined`, so later screenshot activation cannot target that tab.
- `apps/web/src/store/browser-panel.ts:58-74` supports async request fulfillment through `requestedTab`, but it does not return the created tab id to main.

Concrete missing work:

- Replace the fire-and-forget fallback with an invoke/ack path that returns renderer tab id, or fail fast when the global bridge is unavailable.
- Add validation for app startup timing: call `tabs_new` before BrowserPanel has ever mounted, then assert the returned backend tab can later be activated for screenshot.

### Gap D: hidden-webview screenshot is implemented but not independently validated

Severity: medium.

Evidence:

- Activation before capture exists at `plugins/browser-use/src/desktop.ts:220-221`.
- The prior ExecPlan smoke transcript reports screenshot success, but no checked-in test covers this path.

Concrete missing work:

- Add a repeatable desktop smoke script or Playwright/Electron test that creates two renderer tabs, captures a screenshot for the non-visible backend tab id, and asserts non-empty PNG output.
- Include minimized-window/offscreen behavior in a later test if computer-use screenshots must work when the whole app is not visible.

### Gap E: command semantics tests are helper-level, not backend command-level

Severity: medium.

Evidence:

- `plugins/browser-use/src/browser-commands.test.ts:13-80` tests pure helpers, not `handleCommand()`.
- `handleCommand()` is not exported from `plugins/browser-use/src/desktop.ts:193`, so fake `webContents` tests cannot currently assert command ordering or responses.

Concrete missing work:

- Extract a narrow command executor with injectable registry/context for tests, or export a test-only handler through a local test harness.
- Cover at least `tabs_new`, `screenshot` activation, `type` replacement result, `scroll` failure when movable but unmoved, and recoverable navigation abort response.

## Validation Status

I did not run build, typecheck, Vitest, or desktop smoke during this review. This handoff is a static audit with file:line evidence.

Recommended validation before declaring 100% unblock:

```bash
pnpm exec vitest run plugins/browser-use/src/browser-commands.test.ts plugins/browser-use/src/protocol.test.ts
pnpm --filter @cradle/browser-use build
pnpm --filter @cradle/desktop typecheck
pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/providers/claude-agent/provider.test.ts
```

Recommended smoke additions:

1. Start `pnpm dev:desktop`.
2. From Chat/Claude Agent MCP path, call `browser_tabs_new` once that tool exists, or use direct socket only as a lower-level fallback.
3. Create two tabs with different pages and capture returned backend ids.
4. Switch the visible UI tab and verify no-`tabId` command semantics.
5. Run screenshot against the hidden tab id and assert `image/png` plus non-empty base64.
6. Run navigate, type, keyboard, click, scroll, get_text, dom_snapshot, and wait_for_selector through MCP, not only direct socket.

## Recommendation

Treat the current code as “mostly implemented, not fully proven.” The most important missing implementation item is MCP exposure for tab creation/closing. The most important semantics item is active tab mapping for commands without `tabId`. The most important validation item is a repeatable Chat/MCP or desktop smoke that exercises real renderer tab creation and hidden-tab screenshot, because helper tests cannot prove those cross-process paths.
