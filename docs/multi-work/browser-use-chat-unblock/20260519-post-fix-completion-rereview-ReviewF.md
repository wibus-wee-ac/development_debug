<!--
Input: Browser Use Chat unblock ExecPlan, ReviewD/ReviewE handoffs, current source diffs for browser-use desktop/MCP, desktop plugin host, renderer tab bridge, plugin SDK, and Chat runtime providers/tests.
Output: Independent ReviewF handoff re-reviewing whether ReviewD and ReviewE blockers were resolved after fixes.
Position: Multi-work post-fix completion re-review artifact for the browser-use Chat unblock.
-->

# ReviewF: Post-Fix Completion Re-Review

Date: 2026-05-19
Scope: code review plus recorded validation evidence. No source files were changed; this handoff is the only artifact.

## Direct Conclusion

No remaining blocker found for the ReviewD and ReviewE items.

The previously blocking provider gaps are resolved for the relevant MCP-capable Chat paths:

- ACP now converts plugin-registered MCP servers into ACP `McpServer[]` and passes them to `newSession`, `loadSession`, and `unstable_resumeSession`.
- Claude Agent still injects registered MCP servers into SDK query options.
- Codex now injects registered MCP servers into Codex config under `mcp_servers`, which covers the additional tool-capable provider path noted after ReviewD.

The previously blocking browser command gaps are also resolved:

- MCP exposes `browser_tabs_new` and `browser_tabs_close`.
- `tabs_new` creates a renderer-owned BrowserPanel tab and records the renderer tab id against the backend tab.
- No-`tabId` commands query the renderer active BrowserPanel tab before falling back to insertion order.
- The desktop renderer bridge now fails loudly when the synchronous global bridge is unavailable instead of silently using a fire-and-forget IPC fallback.
- Screenshot capture activates the mapped renderer tab before `capturePage()` and is bounded by a timeout.

Residual risk: active-tab behavior, hidden-tab screenshot, and MCP tab lifecycle are still validated primarily by the recorded Electron/MCP smoke transcript rather than checked-in automated Electron tests. That is a test automation gap, not a remaining unblock blocker given the current acceptance evidence.

## ReviewD Blockers

### ACP MCP Injection: Resolved

Evidence:

- `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts:52-59` defines `listRegisteredAcpMcpServers()`, reading `getRegisteredMcpServers()` and converting each env entry into ACP `{ name, value }` pairs.
- `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts:172-175` passes `mcpServers: listRegisteredAcpMcpServers()` to ACP `newSession`.
- `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts:187-196` passes the same MCP server list to ACP `loadSession`.
- `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts:204-210` passes the same MCP server list to ACP `unstable_resumeSession`.
- `apps/server/tests/acp-chat-runtime.test.ts:183-189` registers a test `browser-use` MCP server with `BROWSER_BACKEND_SOCKET`.
- `apps/server/tests/acp-chat-runtime.test.ts:356-366` asserts ACP `newSession` receives the browser-use MCP server.
- `apps/server/tests/acp-chat-runtime.test.ts:381-426` asserts ACP `loadSession` and `resumeSession` receive the same browser-use MCP server.

Assessment: ReviewD's concrete ACP blocker is fixed with effective lifecycle-call tests.

### Claude Agent MCP Injection: Still Covered

Evidence:

- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.test.ts:86-135` asserts the SDK `query()` call receives `options.mcpServers['browser-use'].env.BROWSER_BACKEND_SOCKET`.
- The ExecPlan records the focused Claude Agent provider test passing in `docs/exec-plans/20260518-06-browser-use-chat-unblock.md:246-249`.

Assessment: No regression found in the previously passing Claude Agent path.

### Codex MCP Injection: Resolved Where Applicable

Evidence:

- `apps/server/src/modules/chat-runtime/providers/codex/provider.ts:100-107` builds Codex config and attaches `mcp_servers` when registered MCP servers exist.
- `apps/server/src/modules/chat-runtime/providers/codex/provider.ts:119-123` passes that config to `new Codex(...)`.
- `apps/server/src/modules/chat-runtime/providers/codex/provider.ts:315-328` converts the plugin registry shape into Codex `mcp_servers.<name>` config, preserving `command`, `args`, and `env`.
- `apps/server/tests/sdk-providers.test.ts:365-375` asserts `new Codex(...)` receives `config.mcp_servers['browser-use']` with `BROWSER_BACKEND_SOCKET`.

Assessment: Codex is now covered as an MCP-capable provider path. I did not find evidence that `standard` or `jar-core` expose an equivalent MCP config surface in the reviewed files; that remains out of this unblock's concrete fix set rather than an unresolved blocker from ReviewD.

## ReviewE Blockers

### MCP Tab Tools: Resolved

Evidence:

- `plugins/browser-use/src/mcp-server.ts:224-241` registers `browser_tabs_new` and forwards `type: 'tabs_new'` to the socket backend.
- `plugins/browser-use/src/mcp-server.ts:243-259` registers `browser_tabs_close` and forwards `type: 'tabs_close'`.
- `docs/exec-plans/20260518-06-browser-use-chat-unblock.md:282-286` records MCP stdio smoke evidence: `tools/list` included `browser_tabs_new` and `browser_tabs_close`, `browser_tabs_new` created `tab-3`, `browser_get_text` read it, and `browser_tabs_close` closed it.

Assessment: The model-side MCP surface can now self-bootstrap and close browser tabs.

### Active Tab Semantics: Resolved For MCP-Created Tabs

Evidence:

- `plugins/browser-use/src/desktop.ts:51-55` stores optional `rendererTabId` on each backend webview entry.
- `plugins/browser-use/src/desktop.ts:106-121` asks `desktopContext.getActiveBrowserTab()` for the renderer active tab and maps that renderer id back to a backend entry before falling back to insertion order.
- `plugins/browser-use/src/desktop.ts:124-134` routes all no-`tabId` command lookup through the async active-webview lookup.
- `plugins/browser-use/src/desktop.ts:185-201` records the renderer tab id returned by `requestBrowserTab()` on the newly registered backend webview.
- `apps/desktop/src/main/plugin-loader.ts:210-225` implements `getActiveBrowserTab()` by executing `globalThis.__cradleBrowserUseGetActiveTab()` in the renderer.
- `apps/web/src/components/layout/app-layout.tsx:115-119` exposes `__cradleBrowserUseGetActiveTab` from the BrowserPanel Zustand state.
- `docs/exec-plans/20260518-06-browser-use-chat-unblock.md:267-279` records smoke evidence that no-`tabId` commands followed the visible second tab and then followed the first tab after screenshot activation.

Assessment: ReviewE's insertion-order active-tab blocker is fixed for the path that matters to Chat/MCP tab creation. One nuance remains: `plugins/browser-use/src/desktop.ts:510-512` still ignores the host-supplied `_tabId` on generic webview creation. A user-created tab outside `browser_tabs_new` may not have `rendererTabId` mapped, so no-`tabId` lookup can fall back to insertion order for that tab. This is not a blocker for the reviewed Chat unblock because MCP-created tabs are mapped and smoke-tested.

### Renderer Tab Bridge: Resolved

Evidence:

- `packages/plugin-sdk/src/desktop.ts:13-20` updates the desktop plugin contract so `requestBrowserTab()` returns a renderer tab id and adds `activateBrowserTab()` plus `getActiveBrowserTab()`.
- `apps/desktop/src/main/plugin-loader.ts:175-193` executes `__cradleBrowserUseCreateTab(url)` and throws `Renderer browser tab bridge is not available` if the bridge does not return a string.
- `apps/web/src/components/layout/app-layout.tsx:102-105` implements the synchronous renderer bridge by creating a BrowserPanel tab and returning its `bt-*` id.
- `apps/web/src/components/layout/app-layout.tsx:117-119` installs create, activate, and active-tab lookup bridge functions on `window`.

Assessment: The prior fire-and-forget fallback is gone from the plugin host path. Failure before bridge registration is now loud and diagnosable.

### Hidden-Tab Screenshot: Resolved With Smoke Evidence

Evidence:

- `plugins/browser-use/src/desktop.ts:84-92` activates the mapped renderer tab and waits briefly after activation.
- `plugins/browser-use/src/desktop.ts:226-234` calls `activateRendererTab(entry)` before `entry.wc.capturePage()` and wraps capture in a 3000ms timeout.
- `apps/desktop/src/main/plugin-loader.ts:194-209` forwards activation to `__cradleBrowserUseActivateTab(tabId)`.
- `apps/web/src/components/layout/app-layout.tsx:106-114` validates the renderer tab exists, opens the browser panel, and sets that tab active.
- `apps/web/src/features/browser/browser-panel.tsx:308-317` keeps all webviews rendered while only the active one is visible, which is the hidden-tab case this fix targets.
- `docs/exec-plans/20260518-06-browser-use-chat-unblock.md:267-279` records hidden-tab screenshot smoke evidence: screenshot returned `image/png` with base64 length `13448`, and the default active heading changed to the screenshot target afterward.

Assessment: The implementation addresses the hidden-tab hang and the smoke transcript covers the specific regression path. The remaining risk is only that this cross-process behavior is not represented by an automated Electron test.

## Tests And Smoke Evidence

Recorded passing gates:

- `docs/exec-plans/20260518-06-browser-use-chat-unblock.md:240-244` records `pnpm exec vitest run plugins/browser-use/src/browser-commands.test.ts plugins/browser-use/src/protocol.test.ts` passing with 9 tests.
- `docs/exec-plans/20260518-06-browser-use-chat-unblock.md:246-249` records ACP plus Claude Agent provider tests passing.
- `docs/exec-plans/20260518-06-browser-use-chat-unblock.md:251-254` records SDK provider, ACP, and Claude Agent tests passing together with 13 tests.
- `docs/exec-plans/20260518-06-browser-use-chat-unblock.md:256-263` records server typecheck, desktop typecheck, and web TypeScript check passing.
- `docs/exec-plans/20260518-06-browser-use-chat-unblock.md:265-279` records Electron socket smoke covering two distinct tabs, no-`tabId` active tab semantics, type, keyboard, click, scroll, text, AX snapshot, hidden-tab screenshot, and active-tab switch after screenshot.
- `docs/exec-plans/20260518-06-browser-use-chat-unblock.md:282-286` records MCP stdio smoke covering tool listing, `browser_tabs_new`, `browser_get_text`, and `browser_tabs_close`.

Current focused test evidence in source:

- `apps/server/tests/acp-chat-runtime.test.ts:356-366` covers ACP `newSession` MCP injection.
- `apps/server/tests/acp-chat-runtime.test.ts:381-426` covers ACP `loadSession` and `resumeSession` MCP injection.
- `apps/server/tests/sdk-providers.test.ts:365-375` covers Codex MCP injection.
- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.test.ts:86-135` covers Claude Agent MCP injection.

Gap that remains non-blocking:

- There is no checked-in automated Electron test for renderer bridge creation, active-tab lookup, or hidden-tab screenshot. The ExecPlan smoke transcript is the current evidence for those cross-process paths.

## Final Readiness Statement

ReviewD and ReviewE blockers are resolved. I would mark this post-fix re-review as pass for the browser-use Chat unblock, with one follow-up recommendation: add a repeatable Electron smoke or integration test for `browser_tabs_new`, no-`tabId` active-tab routing, and hidden-tab screenshot so these cross-process guarantees do not rely only on the recorded manual smoke transcript.
