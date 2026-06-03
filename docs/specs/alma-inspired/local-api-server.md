# 本地 API Server

## 目标

Cradle 应继续把本地 HTTP server 作为 desktop、web、CLI、plugins、agents 之间的 canonical 产品边界。

## Alma 证据

Alma main process 启动 Express API server，并通过 preload 暴露端口。它的 API 覆盖 chat、providers、workspace、plugins、MCP、activity、computer use、bot bridges、memory、cron、heartbeat、usage、gallery、snapshot 等能力，并用 WebSocket 承载 live thread 与 terminal 类流程。

## Cradle 当前状态

Cradle 已经有 Elysia server、OpenAPI、模块化 routes、CLI metadata、DB lifecycle、plugin activation 和 desktop fork orchestration。该能力已覆盖。

## Owner / Namespace

`apps/server` 拥有 API 语义。`apps/desktop` 只负责启动与监控 server，不实现业务 routes。CLI 和 Web 消费生成的 API contract。

## 目标行为

- 每个 Alma-inspired feature 在进入实现前必须明确 server owner。
- API route 需要公开 OpenAPI metadata；适合 CLI 的 route 需要补 `x-cradle-cli`。
- WebSocket 只用于真正 live 的 channel，普通 CRUD 继续走 HTTP。
- Desktop preload 只暴露 HTTP 无法表达的 native 能力。

## 验收

- 新功能 proposal 明确说明使用 HTTP、WebSocket 还是 native IPC。
- 不在 `apps/desktop` 里新增业务语义 route。
- 生成 CLI 能继续消费 server-owned feature API。
