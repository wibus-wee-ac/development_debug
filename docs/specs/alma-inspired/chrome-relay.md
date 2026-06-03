# Chrome Relay

## 目标

Cradle 需要区分 in-app browser automation 和 external browser relay。只有在出现明确用户 workflow 时，才应增加外部 Chrome relay。

## Alma 证据

Alma 有 Chrome Relay routes，用于 launch Chrome、list tabs、navigate、read DOM、screenshot、click、type、upload、back/forward、detach、token handling。

## Cradle 当前状态

Cradle browser panel 是 embedded webview；browser-use MCP 通过 Electron debugger 控制这个 panel。它没有把外部 Chrome profile 作为产品能力来启动和控制。

## Owner / Namespace

`plugins/browser-use` 继续拥有 in-app browser automation。未来 `external-browser` connector 拥有外部 Chrome process lifecycle、debug port、profile path、permissions。

## 目标行为

- 用户明确选择 automation target 是 in-app browser 还是 external browser。
- External browser profile 隔离且可见。
- Upload/download 受 policy 控制。
- Cookies 和 user sessions 不在 browser contexts 间静默复制。

## API 草案

- `POST /browser/external/launch`
- `GET /browser/external/tabs`
- `POST /browser/external/tabs/:id/navigate`
- `POST /browser/external/tabs/:id/action`

## 数据模型

持久化 external browser sessions、profile paths、debug ports、user consent state。不在 Cradle DB 保存 cookies。

## 验收

- External browser relay 未经显式 opt-in 不能附着到现有用户 profile。
- In-app browser tools 继续独立工作。
- 关闭 relay session 时关闭 managed Chrome process，除非用户明确 detach。
