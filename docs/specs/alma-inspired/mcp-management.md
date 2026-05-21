<!--
Input: Alma MCP settings evidence and Cradle plugin MCP registry audit.
Output: Spec for MCP management UI and server records.
Position: docs/specs/alma-inspired/mcp-management.md
-->

# MCP 管理

## 目标

Cradle 需要提供用户可见的 MCP 管理表面，同时保留 plugin-owned MCP registrations 的所有权边界。

## Alma 证据

Alma renderer 有 `MCPSettings`、`MCPMarketplace`、installed server views、server edit dialogs、OAuth badges、resource viewers。main 支持 stdio、Streamable HTTP、SSE、tools、resources、templates、notifications、marketplace routes。

## Cradle 当前状态

Cradle plugins 可以注册 MCP servers，Claude Agent、Codex、ACP runtime providers 可以消费 plugin MCP registry。但当前没有用户可见的 MCP server catalog、marketplace、resource viewer 或非 plugin MCP lifecycle UI。

## Owner / Namespace

`apps/server/src/plugins` 继续拥有 plugin-registered MCP capability records。未来 `apps/server/src/modules/mcp` 拥有 user-managed MCP server records、connection checks、tool/resource catalog snapshots 和 UI-facing status。

## 目标行为

- 用户可以新增、编辑、启用、禁用、删除 user-managed MCP servers。
- UI 必须区分 plugin-owned MCP servers 和 user-managed MCP servers。
- Runtime providers 接收合并后的只读 MCP projection，并带 owner metadata。
- MCP resources 和 templates 可被查看，不需要调用 tool。

## API 草案

- `GET /mcp/servers`
- `POST /mcp/servers`
- `PUT /mcp/servers/:id`
- `POST /mcp/servers/:id/check`
- `GET /mcp/servers/:id/tools`
- `GET /mcp/servers/:id/resources`

## 验收

- 禁用 user MCP server 后，新 runtime session 不再收到它。
- Plugin-owned MCP server 不能被 user MCP UI 编辑。
- Connection check 失败时保留上一份可用配置。
