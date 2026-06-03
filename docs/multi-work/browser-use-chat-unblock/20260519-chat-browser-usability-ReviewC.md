# ReviewC: Chat Browser Usability Remaining Blockers

Date: 2026-05-19
Scope: code review only. No source changes were made outside this handoff file.

## Direct Conclusion

除当前已知的 browser panel 可能以 1px 挂载、导致 `tabs_list` 为空之外，仍有一个独立 blocker：Chat/Claude Agent 侧的 MCP `browser_tabs_new` 不能真正创建 renderer 里的新 browser tab 或新 `<webview>`，只能复用已经存在的最后一个 webview。

这意味着 computer-use 无法从模型工具调用侧自举一个浏览器会话。即使 UI 已经打开 browser panel 并自动创建了首个 tab，`browser_tabs_new` 的语义仍不是“new tab”，而是“navigate active/last webview”。这会让多标签、显式 tab id、恢复到目标 tab、以及从 Chat 发起浏览器会话的可用性都不可靠。

## Evidence

### 1. Renderer tab state owns real webview creation

`apps/web/src/store/browser-panel.ts:29-76` 中，真实 tab 生命周期在 Zustand store 内部：

- 初始 `tabs` 为空。
- `createTab(url)` 生成 renderer tab id，如 `bt-0`，并把 tab 放进 `tabs`。
- `closeTab(id)` 从 renderer state 中删除 tab。

`apps/web/src/features/browser/browser-panel.tsx:301-314` 中，`<webview>` 完全由 `tabs.map(...)` 渲染。因此只有 renderer store 创建了 tab，Electron 才会 attach webview，desktop plugin 才能注册对应 `WebContents`。

### 2. BrowserPanel 当前会自动创建首个 tab，但这只覆盖首屏空态

当前文件已经不完全等同于 ExecPlan 里的旧状态。`apps/web/src/features/browser/browser-panel.tsx:59-67` 有 `createdInitialTabRef`，在 panel mount 且 `tabs.length === 0` 时自动 `createTab('about:blank')`。

这能缓解“打开面板后没有首个 webview”的问题，但它没有给 MCP 后端提供创建真实 renderer tab 的能力。它也不保证 panel 关闭/重开、跨 Chat tab、或模型主动 `tabs_new` 时的 tab 语义正确。

### 3. Desktop plugin 的 `tabs_new` 只复用最后一个已注册 webview

`plugins/browser-use/src/desktop.ts:64-69` 的 `getActiveWebview()` 返回 `webviewRegistry` 中最后一个 entry。

`plugins/browser-use/src/desktop.ts:345-363` 的 `tabs_new`：

- 调用 `getActiveWebview()`。
- 没有 active webview 时直接返回 `No webview available. Browser panel must be open.`
- 如果传了 URL，就对这个 existing entry 执行 `entry.wc.loadURL(cmd.url)`。
- 返回 existing webview 的 registry id。

因此 `tabs_new` 不会通知 renderer `createTab()`，不会产生新的 `<webview>`，也不会改变 renderer tab bar。MCP 工具名和用户预期是 “new tab”，实际行为是 “navigate last registered tab”。

### 4. UI tab id 与 plugin tab id 是两个命名空间，没有显式映射

Renderer store 创建 `bt-*` id：`apps/web/src/store/browser-panel.ts:33-48`。

Desktop plugin 注册 `tab-*` id：`plugins/browser-use/src/desktop.ts:84-107`。

Electron main 的 attach event 也生成了另一个未被使用的 `tab-${Date.now()}`：`apps/desktop/src/main/index.ts:81-85`，但 `plugins/browser-use/src/desktop.ts:437-438` 忽略传入的 `_tabId`，自行生成 `tab-*`。

结果是 UI active tab、plugin active webview、MCP returned tab id 三者没有稳定关联。只用 “last registry entry” 近似 active tab，在多标签、隐藏 tab、关闭 tab、Chat tab 切换后都可能控制错对象。

### 5. Claude Agent provider 已注入 MCP server，但还缺可用性验收

`apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts:257-260` 会把 `getRegisteredMcpServers()` 合并进 `queryOptions.mcpServers`。

`apps/server/src/modules/chat-runtime/providers/claude-agent/provider.test.ts` 已覆盖 `browser-use` MCP config 被传给 Claude Agent SDK，包含 `BROWSER_BACKEND_SOCKET`。

这证明 provider 注入路径基本存在，但没有证明模型实际可发现并可调用 browser tools，也没有证明权限策略不会卡住 browser-use 工具调用。`provider.ts:270-272` 在非 bypass 模式会设置 `canUseTool`，但当前 review 范围内没有看到针对 MCP tool name approval flow 的 browser-use smoke 验收。

## Remaining Blockers

### Blocker A: MCP cannot create a real browser tab

Severity: high.

Why it blocks Chat/computer-use:

- A model/tool call cannot start browser work from an empty browser state.
- `browser_tabs_new` reports success against an existing tab, so downstream logic may believe it has isolated a new tab when it has overwritten the user's current browser page.
- Multi-tab workflows cannot be trusted because the protocol's `tabId` is backend-only and not tied to renderer tab lifecycle.

Concrete missing acceptance:

- Calling MCP `browser_tabs_new` from Chat creates exactly one visible renderer tab and one registered desktop backend webview.
- The returned MCP `tab.id` targets that newly created webview.
- `tabs_list` includes the new tab with the same returned id.
- The browser panel tab bar shows a corresponding tab and makes it active, or there is a documented headless-owned tab model that does not pretend to be a UI tab.
- Creating two tabs via MCP yields two distinct webviews and navigation in one tab does not mutate the other.

### Blocker B: Active tab semantics are not defined across UI and backend

Severity: high for multi-tab and Chat reliability.

Why it blocks Chat/computer-use:

- `getActiveWebview()` means "last registered", not "currently active in BrowserPanel".
- Hidden webviews remain mounted with `display: none`, so the backend registry may contain inactive tabs.
- Closing or switching tabs in the UI changes renderer state, but the backend has no explicit active-tab signal besides webview destruction.

Concrete missing acceptance:

- Switching UI tabs updates backend active target, or all MCP commands require explicit backend `tabId`.
- A command without `tabId` controls the same tab that the BrowserPanel visually marks active.
- After closing the active tab, commands without `tabId` target the new visible active tab or fail with a clear error.
- A test or smoke transcript covers at least: create two tabs, navigate both to different URLs, switch visible active tab, run `get_text` without `tabId`, and prove it reads the visible tab.

### Blocker C: Chat-side tool usability is only configuration-tested

Severity: medium-high.

Why it blocks Chat/computer-use:

- Provider unit coverage verifies MCP server config shape, not end-to-end tool discovery/invocation.
- The permission path can still interrupt browser-use tools in normal `acceptEdits` mode.
- A user-visible Chat workflow needs proof that Claude Agent can see `browser-use` tools and call through to the same socket used by direct tests.

Concrete missing acceptance:

- In `pnpm dev:desktop`, with a Chat session using Claude Agent, the model/tool runtime can list or invoke browser-use MCP tools.
- A Chat prompt can navigate a page through the MCP server and the BrowserPanel visibly reflects the navigation.
- In the default permission mode, browser-use MCP tool calls either receive an approval prompt with usable labels or are covered by an explicit safe allow policy.
- Cancellation while a browser-use approval is pending or a browser command is running does not leave the Chat turn hung.

## Suggested Fix Direction

The clean fix should choose one owner for browser tab lifecycle.

Recommended path:

- Keep renderer `BrowserPanel` as owner of visible UI tabs and webviews.
- Add an Electron IPC contract from desktop plugin or main process to renderer for `createBrowserTab`, `closeBrowserTab`, `setActiveBrowserTab`, and active-tab notifications.
- Make `tabs_new` request renderer tab creation, wait until `did-attach-webview` registers the new `WebContents`, then return the backend tab id mapped to the renderer tab.
- Preserve a mapping between renderer tab id and backend tab id; avoid relying on insertion order.

Alternative path:

- Define browser-use MCP tabs as backend-owned only and do not expose them as UI tabs.
- This is less aligned with the current in-app browser panel goal, because the user-visible BrowserPanel would no longer be the source of truth.

## Review Notes Against Current Known Issue

The current file state already includes an automatic first tab creation in `BrowserPanel`, which may partially address the previously known `tabs_list` empty failure after the panel is mounted. However, the remaining blocker above still exists because automatic first-tab creation is mount-time UI behavior, while Chat/computer-use needs a command-level lifecycle contract from MCP to real webviews.

Acceptance for the original 1px/empty-list issue should therefore be extended:

- Opening the browser panel at normal width creates one visible webview and `tabs_list` returns one tab.
- Calling `browser_tabs_new` creates another visible webview, not just navigates the first one.
- Closing and reopening the panel does not leave the backend registry with stale destroyed entries or create duplicate backend ids for the same visible tab.
