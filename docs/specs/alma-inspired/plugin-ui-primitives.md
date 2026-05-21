<!--
Input: Alma preload plugin UI primitives and Cradle plugin SDK audit.
Output: Spec for plugin UI primitives.
Position: docs/specs/alma-inspired/plugin-ui-primitives.md
-->

# Plugin UI Primitives

## 目标

Cradle plugin 应能请求 host-owned 标准 UI primitive，而不是每个 plugin 都为了简单交互自带一整套 panel。

## Alma 证据

Alma preload 暴露 `pluginStatusBar`、`pluginInputBox`、`pluginQuickPick`、`pluginConfirmDialog`、`pluginNotification`、`pluginTheme`、`toolApprovalDialog`。

## Cradle 当前状态

Cradle plugin SDK 支持 web panels、commands、server routes、MCP servers、skills、shared config 和 desktop webview hooks，但没有 universal quick pick、input box、confirm dialog、status bar、notification primitive。

## Owner / Namespace

`packages/plugin-sdk` 定义 contracts。`apps/web` 拥有 host UI rendering、focus management 和 accessibility。`apps/desktop` 只在 Web 无法安全表达时提供 native overlay。

## 目标行为

- Plugin command 可以请求 `showQuickPick`、`showInputBox`、`showConfirm`、`showNotification`、`setStatusBarItem`。
- Host UI 统一处理 focus、accessible name、cancel、timeout。
- Plugin request 由 plugin identity 与 permission grants 约束。

## API 草案

- `plugin.ui.showQuickPick(options)`
- `plugin.ui.showInputBox(options)`
- `plugin.ui.showConfirm(options)`
- `plugin.ui.showNotification(options)`
- `plugin.ui.statusBar.set(item)`

## 数据模型

只持久化 status bar registrations 和 permission grants。瞬态 prompts 存内存，并关联 command execution id。

## 验收

- Plugin 可以要求用户从列表中选择，并收到 selected item。
- Dismiss UI 时返回结构化 cancellation result。
- Plugin 不能冒充另一个 plugin 的 status bar 或 notification identity。
