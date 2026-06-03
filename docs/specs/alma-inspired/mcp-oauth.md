# MCP OAuth

## 目标

Cradle 需要支持 remote MCP servers 的 OAuth lifecycle，包括授权、callback、token refresh、revoke 和 reauth 状态。

## Alma 证据

Alma preload 暴露 `mcpOAuth.getStatus`、`startAuth`、`revoke`、`onAuthCallback`、`onNeedsReauth`。main process 包含 callback handling、token refresh、pending callback tracking、reauthorization notifications。

## Cradle 当前状态

Cradle 可以把 plugin MCP servers 传给 runtimes，但没有 OAuth token lifecycle、callback endpoint、refresh handling 或 reauth notification。

## Owner / Namespace

未来 `mcp-oauth` 应与 MCP owner 同级。`secrets` 存储 token material。Desktop 可以打开外部 auth URL，但不拥有 token 语义。

## 目标行为

- 用户从 MCP server settings 启动 OAuth。
- Server 加密存储 token，并在过期前刷新。
- 刷新失败时 runtime call 返回结构化 `reauth_required`。
- UI 展示 authorized、expired、revoked、unsupported 状态。

## API 草案

- `GET /mcp/servers/:id/oauth/status`
- `POST /mcp/servers/:id/oauth/start`
- `GET /mcp/oauth/callback`
- `POST /mcp/servers/:id/oauth/revoke`

## 验收

- Revoke OAuth 会删除 token secrets。
- Callback validation 拒绝 state 不匹配请求。
- Reauth notification 只暴露 server id 和状态，不泄露 credentials。
