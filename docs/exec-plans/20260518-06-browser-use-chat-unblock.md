# Browser Use Chat Unblock

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintained in accordance with `/Users/wibus/.agents/skills/execplan/references/PLANS.md`.

## Purpose / Big Picture

After this change, a Cradle desktop Chat session can use the `browser-use` plugin as a real in-app browser control surface for future computer-use style workflows. The user-visible proof is direct: start `pnpm dev:desktop`, open a Chat tab, open the browser panel, create a browser tab, and verify that the plugin can navigate, type into an input, click a button, scroll the page, read text, take a screenshot, and return an accessibility snapshot through the same Unix socket and MCP server that Claude Agent receives in Chat.

This work matters because the first manual desktop test showed that the plugin was present but not fully usable. Navigation reported failure even when the page loaded, text entry appended before old input values instead of replacing them, keyboard commands returned success without changing the input, and scroll success did not reliably prove movement. A later `computer-use` integration would inherit these defects unless the low-level browser control contract is fixed now.

## Progress

- [x] (2026-05-18 15:40Z) Reproduced the desktop plugin path in `pnpm dev:desktop`: `@cradle/browser-use` activated on desktop and server, `/api/plugins` listed it, Chat tab browser panel created a `webview`, and socket `tabs_list` returned `tab-1`.
- [x] (2026-05-18 15:40Z) Identified concrete failures: `navigate` returns `ERR_ABORTED` despite successful navigation, `type` inserts before the old value on macOS, `keyboard` does not reliably edit focused inputs, and `scroll` needs a stronger success condition.
- [x] (2026-05-18 15:40Z) Created this ExecPlan and selected a DAG-style multi-work flow for implementation plus independent provider/Chat integration review.
- [x] (2026-05-18 17:45Z) Fixed the active plugin backend so navigation waits for document readiness, typing replaces input values with DOM events, keyboard has an editable text fallback, click dispatches DOM mouse events, scroll uses observable DOM movement, and screenshot uses Electron capture from an activated renderer tab.
- [x] (2026-05-18 17:45Z) Kept `apps/desktop/src/main/browser-backend.ts` behaviorally aligned enough for desktop typecheck while leaving plugin-owned lifecycle in `plugins/browser-use`.
- [x] (2026-05-18 17:45Z) Added focused pure helper coverage for command payloads and protocol framing, and captured a repeatable socket smoke transcript for the Electron path.
- [x] (2026-05-18 17:45Z) Verified Chat runtime passes plugin-registered MCP servers to the Claude Agent provider with `BROWSER_BACKEND_SOCKET` in the effective MCP config.
- [x] (2026-05-18 18:07Z) Ran build/typecheck/test gates and a `pnpm dev:desktop` socket smoke test that creates real renderer browser tabs from the tool side.
- [x] (2026-05-18 18:36Z) Resolved multi-work completion audits ReviewD and ReviewE: ACP Chat now receives registered MCP servers, the MCP server exposes tab create/close tools, no-`tabId` commands follow the renderer-visible BrowserPanel tab, and tab creation fails loudly if the renderer bridge is unavailable.
- [x] (2026-05-18 18:40Z) Verified MCP stdio tool surface from the model side: `tools/list` includes `browser_tabs_new` and `browser_tabs_close`; `browser_tabs_new` created a real renderer tab, `browser_get_text` read it, and `browser_tabs_close` closed it.
- [x] (2026-05-18 18:50Z) Audited Codex SDK provider after noticing its SDK/CLI supports MCP tool calls and `mcp_servers` config overrides; added registered MCP server injection into Codex provider config and verified it with existing SDK provider tests.
- [x] (2026-05-18 18:54Z) Completed post-fix multi-work rereview in `docs/multi-work/browser-use-chat-unblock/20260519-post-fix-completion-rereview-ReviewF.md`; the rereview found no remaining blocker from ReviewD or ReviewE.

## Surprises & Discoveries

- Observation: In dev desktop, Electron's `app.getPath('userData')` is `/Users/wibus/Library/Application Support/@cradle/desktop`, but `plugins/browser-use/src/mcp-server.ts` falls back to `/Users/wibus/Library/Application Support/Cradle/browser-backend.sock` when no `BROWSER_BACKEND_SOCKET` env var is provided.
  Evidence: The running desktop logged `Browser backend started on /Users/wibus/Library/Application Support/@cradle/desktop/browser-backend.sock`; the MCP server default path code uses `Application Support/Cradle`.

- Observation: The server plugin path is correct when launched by Cradle desktop because `plugins/browser-use/src/server.ts` registers the MCP server with `env: { BROWSER_BACKEND_SOCKET: socketPath }`.
  Evidence: The server plugin reads `ctx.sharedConfig.get('BROWSER_BACKEND_SOCKET')`, and `apps/desktop/src/main/plugin-loader.ts` maps desktop shared config to `CRADLE_PLUGIN_BROWSER_BACKEND_SOCKET` for the server process.

- Observation: On macOS, Ctrl+A inside an input does not select all text; it moves the caret to the start. The current `type` command uses Ctrl+A before Backspace, so `Input.insertText` prepends new text to the old value.
  Evidence: In a local HTTP test page, calling `type` with text `cradle plugin` on an input with value `old` produced `cradle pluginold`.

- Observation: `webContents.loadURL` can reject with `ERR_ABORTED (-3)` in the webview even though `location.href` changes to the requested URL.
  Evidence: Direct socket calls to `navigate` returned `ok:false` for both `http://127.0.0.1:37891/` and `about:blank`, but immediate `eval location.href` returned the target URL.

- Observation: CDP and DOM commands can still operate on a hidden browser panel `webview`, but screenshot capture can hang when the target tab is no longer the visible BrowserPanel tab.
  Evidence: The socket smoke passed `type`, `keyboard`, `click`, `scroll`, `get_text`, and `dom_snapshot` against `tab-1` after `tab-2` became active, but `screenshot` timed out until the plugin activated the renderer tab before `webContents.capturePage()`.

- Observation: The ACP Chat provider was still a real Chat runtime and explicitly passed `mcpServers: []` for every session lifecycle entry point.
  Evidence: ReviewD identified `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts` calls to `newSession`, `loadSession`, and `unstable_resumeSession` with empty MCP arrays. The fix now converts `getRegisteredMcpServers()` into ACP `McpServer[]` and passes it to all three calls.

- Observation: The socket protocol implemented `tabs_new` and `tabs_close`, but the MCP server did not expose those commands to the model.
  Evidence: ReviewE identified missing `browser_tabs_new` / `browser_tabs_close` registrations in `plugins/browser-use/src/mcp-server.ts`. The fix adds both tools and the MCP stdio smoke verified they are listed and callable.

- Observation: Default browser commands without `tabId` previously targeted the last registered backend webview, not the visible BrowserPanel tab.
  Evidence: ReviewE identified insertion-order active tab selection in `plugins/browser-use/src/desktop.ts`. The fix asks the renderer for `__cradleBrowserUseGetActiveTab()` and maps that renderer `bt-*` id to the backend `tab-*` entry before falling back to insertion order.

- Observation: Codex SDK exposes MCP tool call events and the Codex CLI supports `mcp_servers` configuration, even though the SDK `ThreadOptions` type does not have a direct `mcpServers` field.
  Evidence: `@openai/codex-sdk` types include `McpToolCallItem`, and `codex mcp add` writes `[mcp_servers.<name>]` plus `[mcp_servers.<name>.env]` config sections. The provider now injects registered MCP servers into `new Codex({ config: { mcp_servers: ... } })`.

## Decision Log

- Decision: Keep the plugin-owned desktop backend in `plugins/browser-use/src/desktop.ts` as the source of truth for this unblock.
  Rationale: `pnpm dev:desktop` discovers and activates `plugins/browser-use/dist/desktop.mjs`; the older `apps/desktop/src/main/browser-backend.ts` is not the active plugin path, but it still exists and may be compiled by desktop typecheck.
  Date/Author: 2026-05-18 / Codex

- Decision: Treat successful browser commands as observable state changes, not only successful CDP method returns.
  Rationale: The observed failures returned `success:true` while the page state was unchanged or wrong. Acceptance must read back the input value, clicked output, current URL, scroll position, screenshot metadata, and accessibility nodes.
  Date/Author: 2026-05-18 / Codex

- Decision: Use direct DOM selection for the "replace text in this element" operation, then `Input.insertText` for the actual text insertion.
  Rationale: The tool contract is `browser_type(selector, text)`, not "press these exact keys". Using `el.focus()` plus `HTMLInputElement.select()` or an equivalent editable selection API makes replacement platform-independent while still inserting text through the browser input path.
  Date/Author: 2026-05-18 / Codex

- Decision: `tabs_new` must create a real renderer-owned BrowserPanel tab instead of reusing the latest registered `webview`.
  Rationale: Chat use needs visible, inspectable browser state. Reusing the last `webview` mutates the wrong tab and breaks multi-tab workflows.
  Date/Author: 2026-05-18 / Codex

- Decision: Screenshot should activate the renderer BrowserPanel tab before capture and wrap capture with a bounded timeout.
  Rationale: Hidden `webview` capture can hang indefinitely. Activating the mapped renderer tab makes capture observable, and the timeout prevents a stuck Electron capture from wedging the MCP call.
  Date/Author: 2026-05-18 / Codex

- Decision: ACP Chat is in scope for this unblock because it is a registered selectable Chat runtime.
  Rationale: The user's provider concern was not limited to Claude Agent. ACP has a protocol-level `mcpServers` field, so passing `[]` would leave a real Chat provider unable to receive browser-use/computer-use tools.
  Date/Author: 2026-05-18 / Codex

- Decision: Renderer tab creation must be synchronous from the desktop plugin perspective.
  Rationale: The previous fire-and-forget IPC fallback could create a tab without returning the renderer tab id, which later broke screenshot activation and active-tab mapping. If the renderer bridge is unavailable, failing at `tabs_new` is more diagnosable than creating a partially mapped tab.
  Date/Author: 2026-05-18 / Codex

- Decision: No-`tabId` browser commands should follow the renderer-visible BrowserPanel tab.
  Rationale: Model calls often omit `tabId` after creating or selecting a browser tab. Matching visible UI state is safer than using backend insertion order in multi-tab workflows.
  Date/Author: 2026-05-18 / Codex

- Decision: Codex SDK Chat is in scope for MCP injection because the SDK and CLI expose MCP semantics.
  Rationale: Unlike OpenAI-compatible single-step runtime and Jarvis/system-agent, Codex can report MCP tool calls and can receive MCP server config through CLI config overrides. Leaving Codex unconfigured would keep a selectable tool-capable Chat provider from seeing browser-use.
  Date/Author: 2026-05-18 / Codex

## Outcomes & Retrospective

Completed for this unblock. The active `browser-use` desktop plugin can now self-bootstrap browser tabs from the Chat renderer path and control distinct real `webview` tabs through both the Unix socket and the MCP stdio server. The final socket smoke created `tab-1` and `tab-2`, verified they were distinct, verified no-`tabId` commands followed the visible second tab, edited and clicked only `tab-1`, verified `tab-2` still showed `Browser Use Smoke Two`, scrolled `tab-1` from `0` to `700`, read text and accessibility nodes, captured a PNG screenshot for hidden `tab-1` with base64 length `13448`, and verified the screenshot activation made no-`tabId` commands target `tab-1`.

The provider side is unblocked for the Chat runtimes that can accept MCP configuration: Claude Agent receives `queryOptions.mcpServers.browser-use.env.BROWSER_BACKEND_SOCKET`, ACP Chat receives ACP-format `mcpServers` on `newSession`, `loadSession`, and `resumeSession`, and Codex SDK Chat receives Codex CLI `mcp_servers.browser-use` config. OpenAI-compatible remains a single-step runtime with `maxSteps: 1` and no tool execution; Jarvis/system-agent did not expose an MCP server configuration surface in the reviewed code. Those runtimes are not treated as browser-use/computer-use-capable provider paths by this unblock.

The key remaining risk is that screenshot still depends on Electron `webContents.capturePage()` after activating the target renderer tab. It is now bounded by a timeout instead of hanging indefinitely, and it passed the current hidden-tab smoke path, but future offscreen or minimized-window behavior should be tested separately if the computer-use flow needs screenshots while the entire app window is not visible.

## Context and Orientation

The browser-use plugin is a Cradle plugin under `plugins/browser-use/`. A Cradle plugin can run in multiple processes. The desktop entry is `plugins/browser-use/src/desktop.ts`, built to `plugins/browser-use/dist/desktop.mjs`, and it runs in Electron main. It tracks Electron `webview` `WebContents` objects, attaches the Chrome DevTools Protocol debugger to them, and exposes browser commands over a Unix socket. A Unix socket is a local filesystem path that programs can connect to like a private local network connection.

The MCP entry is `plugins/browser-use/src/mcp-server.ts`, built to `plugins/browser-use/dist/mcp-server.mjs`. MCP means Model Context Protocol: it is the tool server protocol the Claude Agent SDK can use to call tools such as `browser_navigate`, `browser_type`, and `browser_screenshot`. The server plugin entry `plugins/browser-use/src/server.ts` registers this MCP server with Cradle's server plugin registry.

The desktop app starts the server child process in `apps/desktop/src/main/server-process.ts`. The desktop plugin loader in `apps/desktop/src/main/plugin-loader.ts` lets desktop plugins set shared config. That shared config is passed to the server process as `CRADLE_PLUGIN_*` environment variables. The server plugin context in `apps/server/src/plugins/context.ts` turns those environment variables back into a `sharedConfig` map. For browser-use, this is how `BROWSER_BACKEND_SOCKET` reaches the server plugin and then the MCP server config.

The Chat runtime provider of interest is `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts`. It calls `getRegisteredMcpServers()` and attaches all plugin-registered MCP servers to Claude Agent SDK query options. This is the bridge that future computer-use style behavior will need: if the MCP server registry contains `browser-use`, then Chat can expose browser tools to the model runtime.

There is also a legacy backend file at `apps/desktop/src/main/browser-backend.ts`. It duplicates much of the plugin logic but is not currently imported by `apps/desktop/src/main/index.ts`. Because it is still under `apps/desktop/src/main`, desktop typecheck may compile it. This unblock should keep it behaviorally aligned if necessary, but should not reintroduce hardcoded browser-use ownership into `apps/desktop`.

## Plan of Work

First, fix the command semantics in `plugins/browser-use/src/desktop.ts`. Navigation should treat `ERR_ABORTED` as recoverable only when the webview's final URL matches the requested URL or the requested URL is otherwise observably loaded. It should return the final URL and title when loaded, and a real error when the target did not load. Text entry should focus the selector, select the existing value using DOM selection APIs that work on inputs, textareas, and contenteditable elements, and then call `Input.insertText`. Keyboard should map common keys and modifiers into a complete CDP `Input.dispatchKeyEvent` payload with `key`, `code`, `windowsVirtualKeyCode`, `nativeVirtualKeyCode`, and modifier bitmask where practical. Scroll should dispatch a wheel event, then wait briefly until the target page or element scroll offset changes when scrolling is possible.

Second, align `apps/desktop/src/main/browser-backend.ts` if it is still compiled and duplicates active behavior. If a future cleanup deletes it, that belongs in a separate plan because ownership should stay with the plugin. For this unblock, duplicate bug fixes are acceptable only to keep current desktop typecheck and avoid divergent behavior.

Third, add tests around pure helpers. Electron `webContents.debugger` is hard to exercise in unit tests, so extract small helper functions where useful: modifier bit computation, key event payload mapping, editable selection script construction, recoverable navigation error detection, and scroll success evaluation can be tested without launching Electron. Keep the helpers inside the plugin unless a shared package already exists.

Fourth, verify the Chat integration path. Inspect and, if needed, test `plugins/browser-use/src/server.ts`, `apps/server/src/plugins/mcp-registry.ts`, `apps/server/src/plugins/context.ts`, `apps/desktop/src/main/plugin-loader.ts`, `apps/desktop/src/main/server-process.ts`, and `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts`. The acceptance condition is that a desktop plugin socket path becomes the MCP server env var in the Claude Agent provider's `queryOptions.mcpServers.browser-use.env.BROWSER_BACKEND_SOCKET`.

Fifth, run build and typecheck gates. At minimum, run `pnpm --filter @cradle/browser-use build`, `pnpm --filter @cradle/desktop typecheck`, and the focused server or provider test command added or identified during work. Then run `pnpm --filter @cradle/desktop exec electron-vite dev --remoteDebuggingPort 9222`, open a Chat tab, open the browser panel, create a tab, and exercise the direct socket smoke test against a local HTTP page.

## Concrete Steps

From `/Users/wibus/dev/Cradle`, inspect the active plugin and Chat bridge:

    rg -n "BROWSER_BACKEND_SOCKET|registerMcpServer|getRegisteredMcpServers|dispatchKeyEvent|loadURL" plugins/browser-use apps/desktop apps/server/src/modules/chat-runtime apps/server/src/plugins

Edit `plugins/browser-use/src/desktop.ts` to introduce helper functions near the top of the file, before `handleCommand`, and use them in the `navigate`, `type`, `keyboard`, and `scroll` cases. Keep comments short and in English. Avoid changing protocol types unless a helper needs a clearly better shape.

If `apps/desktop/src/main/browser-backend.ts` remains compiled, apply the same helper behavior there or import shared helpers if that can be done without circular ownership. Do not move plugin-owned lifecycle logic into `apps/desktop`.

Add focused tests under `plugins/browser-use/src/` or the nearest existing test convention. If no test harness exists for plugin packages, add a small Vitest test file and make sure the root `vitest` command can discover it, or document a focused command that runs it.

Run:

    pnpm --filter @cradle/browser-use build
    pnpm --filter @cradle/desktop typecheck

If server-side Chat integration tests are added or adjusted, run the focused server test command. If no test is practical, record a concrete code inspection transcript and a desktop smoke transcript in `Artifacts and Notes`.

For manual desktop validation, run:

    pnpm --filter @cradle/desktop exec electron-vite dev --remoteDebuggingPort 9222

Then use the Electron UI to open an existing Chat session, click the header browser toggle, and click `New Tab`. Connect to the socket path printed by the desktop plugin log. Send commands equivalent to:

    tabs_list
    navigate http://127.0.0.1:<test-port>/
    wait_for_selector #btn
    type #name "cradle plugin"
    click #btn
    get_text #out
    scroll down 500
    eval "window.scrollY"
    dom_snapshot
    screenshot

Expected behavior after the fix: navigation returns `ok:true`, the input value is exactly `cradle plugin`, the clicked output is exactly `clicked:cradle plugin`, scroll movement is observable when the page can scroll, the accessibility snapshot includes the page heading and button, and screenshot returns `mimeType: image/png` with non-empty base64.

## Validation and Acceptance

The work is accepted only when all of the following are true.

`pnpm --filter @cradle/browser-use build` completes successfully and produces `plugins/browser-use/dist/desktop.mjs` and `plugins/browser-use/dist/mcp-server.mjs`.

`pnpm --filter @cradle/desktop typecheck` completes successfully. This matters because desktop activates plugins and also compiles any remaining legacy browser backend code.

The focused browser-use tests pass and cover at least macOS-safe replace typing, common keyboard payload construction, and recoverable navigation error classification.

The desktop smoke test proves the actual Electron path: `@cradle/browser-use` is listed by `/api/plugins`, `tabs_list` returns a webview tab after the Chat browser panel opens, and a local HTTP page can be controlled through the socket. The observed transcript must include correct output for navigation, typing, clicking, scrolling, DOM snapshot, and screenshot.

The Chat runtime bridge is verified with evidence that `plugins/browser-use/src/server.ts` registers the MCP server with `BROWSER_BACKEND_SOCKET`, the server plugin context receives desktop shared config, and `ClaudeAgentProvider` includes registered MCP servers in query options. If a test is added, it must assert the effective MCP config shape rather than only checking registry insertion.

## Idempotence and Recovery

All code changes are normal source edits and can be rerun safely. Rebuilding `@cradle/browser-use` overwrites only generated files under that package's `dist` directory. Manual desktop validation creates a transient Electron process and a local socket under Electron user data; stopping `pnpm dev:desktop` removes the socket through plugin deactivation. If a smoke test process hangs, stop only the process started for the smoke test and leave unrelated user processes alone.

Do not delete user data, reset git state, or remove unrelated dirty files. The current working tree already contains unrelated modifications in `apps/web`, `apps/server/src/modules/pty`, and docs. Work with those changes and avoid reverting them.

## Artifacts and Notes

Initial reproduction evidence from 2026-05-18:

    tabs_list -> {"tabs":[{"id":"tab-1","url":"about:blank","title":"about:blank"}]}
    navigate http://127.0.0.1:37891/ -> ok:false ERR_ABORTED
    eval location.href -> "http://127.0.0.1:37891/"
    type #name "cradle plugin" on value "old" -> "cradle pluginold"
    click #btn -> "clicked:cradle pluginold"
    dom_snapshot -> includes RootWebArea, heading, textbox, button
    screenshot -> image/png with non-empty base64

The root cause of the typing bug is the Ctrl+A selection attempt in `plugins/browser-use/src/desktop.ts`. On macOS, Ctrl+A in a text field moves the caret to the start, so Backspace does not clear the field.

Final validation evidence from 2026-05-18:

    pnpm exec vitest run plugins/browser-use/src/browser-commands.test.ts plugins/browser-use/src/protocol.test.ts
    Test Files  2 passed (2)
    Tests       9 passed (9)

    pnpm --filter @cradle/browser-use build
    completed successfully

    pnpm --filter @cradle/desktop typecheck
    completed successfully

    pnpm --filter @cradle/web exec tsc --noEmit
    completed successfully

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/providers/claude-agent/provider.test.ts
    Test Files  1 passed (1)
    Tests       2 passed (2)

    pnpm --filter @cradle/desktop exec electron-vite dev --remoteDebuggingPort 9222
    initialTabs []
    first { id: 'tab-1', title: 'Browser Use Smoke One' }
    second { id: 'tab-2', title: 'Browser Use Smoke Two' }
    tabsAfterNew [
      { id: 'tab-1', title: 'Browser Use Smoke One' },
      { id: 'tab-2', title: 'Browser Use Smoke Two' }
    ]
    valueAfterType cradle plugin
    valueAfterKeyboard cradle plugina
    output clicked:cradle plugina
    secondHeading Browser Use Smoke Two
    scroll 0 700
    textIncludesHeading true
    domSnapshotContains true true
    screenshot image/png 13012

Completion audit validation evidence from 2026-05-18:

    pnpm --filter @cradle/browser-use exec tsc --noEmit
    completed successfully

    pnpm --filter @cradle/browser-use build
    completed successfully

    pnpm exec vitest run plugins/browser-use/src/browser-commands.test.ts plugins/browser-use/src/protocol.test.ts
    Test Files  2 passed (2)
    Tests       9 passed (9)

    pnpm --filter @cradle/server exec vitest run tests/acp-chat-runtime.test.ts src/modules/chat-runtime/providers/claude-agent/provider.test.ts
    Test Files  2 passed (2)
    Tests       4 passed (4)

    pnpm --filter @cradle/server exec vitest run tests/sdk-providers.test.ts tests/acp-chat-runtime.test.ts src/modules/chat-runtime/providers/claude-agent/provider.test.ts
    Test Files  3 passed (3)
    Tests       13 passed (13)

    pnpm --filter @cradle/server typecheck
    completed successfully

    pnpm --filter @cradle/desktop typecheck
    completed successfully

    pnpm --filter @cradle/web exec tsc --noEmit
    completed successfully

    pnpm --filter @cradle/desktop exec electron-vite dev --remoteDebuggingPort 9222
    initialTabs []
    first { id: 'tab-1', title: 'Browser Use Smoke One' }
    second { id: 'tab-2', title: 'Browser Use Smoke Two' }
    tabsAfterNew [
      { id: 'tab-1', title: 'Browser Use Smoke One' },
      { id: 'tab-2', title: 'Browser Use Smoke Two' }
    ]
    defaultHeadingAfterSecond Browser Use Smoke Two
    valueAfterType cradle plugin
    valueAfterKeyboard cradle plugina
    output clicked:cradle plugina
    secondHeading Browser Use Smoke Two
    scroll 0 700
    textIncludesHeading true
    domSnapshotContains true true
    screenshot image/png 13448
    defaultHeadingAfterScreenshot Browser Use Smoke One

    MCP stdio smoke against plugins/browser-use/dist/mcp-server.mjs
    tools browser_click,browser_dom_snapshot,browser_eval,browser_get_text,browser_hover,browser_keyboard,browser_navigate,browser_screenshot,browser_scroll,browser_tabs_close,browser_tabs_list,browser_tabs_new,browser_type,browser_wait_for_selector
    created [tab-3] MCP Tabs Smoke
    text true
    closed Closed tab: tab-3

## Interfaces and Dependencies

The plugin command protocol remains the `BrowserCommand` union in `plugins/browser-use/src/protocol.ts`. No public protocol change is required for this unblock unless implementation discovers a missing parameter needed for correctness.

In `plugins/browser-use/src/desktop.ts`, define or preserve helpers with behavior equivalent to:

    function isRecoverableNavigationAbort(err: unknown, requestedUrl: string, finalUrl: string): boolean
    function buildEditableSelectionExpression(selector: string): string
    function modifierMask(modifiers?: string[]): number
    function keyEventPayload(key: string, modifiers?: string[]): Record<string, unknown>

The exact helper names may change if clearer names are chosen, but they must keep plugin ownership inside `plugins/browser-use` and must be covered by focused tests when practical.

In `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts`, the behavior must remain that `getRegisteredMcpServers()` is merged into `queryOptions.mcpServers` before calling `query({ prompt, options })`.

In `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts`, `getRegisteredMcpServers()` must be converted from the Claude SDK map shape into ACP's `McpServer[]` shape, including env variables as `{ name, value }` pairs, before calling ACP `newSession`, `loadSession`, or `unstable_resumeSession`.

In `apps/server/src/modules/chat-runtime/providers/codex/provider.ts`, `getRegisteredMcpServers()` must be converted into Codex CLI config under `mcp_servers.<name>`, preserving command, args, and env, before constructing `new Codex(...)`.

In `plugins/browser-use/src/mcp-server.ts`, `browser_tabs_new` and `browser_tabs_close` must remain exposed because model-side Chat cannot self-bootstrap a browser session with only direct socket protocol support.

Revision note 2026-05-18: Created this plan after desktop smoke testing exposed behavior-level browser-use failures and after the user requested a `$multi-work` unblock that includes future Chat computer-use readiness.

Revision note 2026-05-18: Updated after completion audits ReviewD and ReviewE found ACP MCP injection, MCP tab lifecycle tools, and active-tab default semantics gaps; recorded the fixes and final validation evidence.

Revision note 2026-05-18: Updated after Codex SDK audit found a tool-capable provider path with MCP config support; recorded Codex MCP injection and the focused provider test evidence.

Revision note 2026-05-18: Updated after ReviewF independently confirmed the post-fix state has no remaining ReviewD/ReviewE blockers.
