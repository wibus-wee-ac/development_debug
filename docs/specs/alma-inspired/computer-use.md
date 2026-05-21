<!--
Input: Alma Computer Use API/PIP evidence and Cradle browser-use/Chronicle audit.
Output: Spec for OS-level Computer Use.
Position: docs/specs/alma-inspired/computer-use.md
-->

# Computer Use

## 目标

如果 Cradle 采用 OS-level Computer Use，必须放在强 approval、audit、owner boundary 后面，因为它可以操作 Cradle 之外的应用。

## Alma 证据

Alma 暴露 Computer Use APIs，用于 app/window state、screenshots、click、drag、key、type、scroll、launch、raise、approval、action log、PiP 和 MCP auto registration。

## Cradle 当前状态

Cradle browser-use 只能控制 in-app browser webview。Chronicle 可以观察 screen content。Cradle 没有 OS-wide app/window automation、approval logs、PiP 或 Computer Use MCP server。

## Owner / Namespace

未来 `computer-use` module 拥有 OS automation policy、action audit、app approvals、runtime sessions。Desktop 拥有 native automation adapters。`approval` module 拥有用户审批决定。

## 目标行为

- OS automation 默认关闭。
- 自动化操作前要求用户批准 app 或 action。
- 每个 action 写 audit log，包括 target app/window、coordinates 或 semantic target、result、安全的 screenshot reference。
- PiP 显示当前 computer-use state，不抢 focus。

## API 草案

- `GET /computer-use/status`
- `GET /computer-use/apps`
- `POST /computer-use/actions`
- `GET /computer-use/approvals`
- `POST /computer-use/approvals`
- `GET /computer-use/actions/log`

## 数据模型

表应包含 `computer_use_sessions`、`computer_use_action_log`、`computer_use_app_approvals`。

## 验收

- 未批准 action 返回 `approval_required`。
- 撤销 app approval 后不能继续操作该 app。
- Action logs 可以导出审计。
