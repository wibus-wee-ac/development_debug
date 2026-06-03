# Plugin Runtime 与 Marketplace

## 目标

Cradle 应保留现有 governed plugin architecture，同时补上类似 Alma 的用户可见 marketplace、安装、更新、权限和生命周期表面。

## Alma 证据

Alma 支持 plugin install、uninstall、enable、disable、permissions、settings、updates、themes、hooks，并有 remote registry URL。安装来源包括 marketplace、URL、npm、local。

## Cradle 当前状态

Cradle 已有 server、desktop、web 三层 plugin runtime，支持 governed descriptors、routes、MCP、skills、hooks、panels、commands、shared config，并已有系统插件。但它还缺完整 marketplace lifecycle UI 和持久化 plugin storage。

## Owner / Namespace

`apps/server/src/plugins` 拥有 plugin discovery、governance、capability records、marketplace metadata 和 lifecycle state。`packages/plugin-sdk` 拥有扩展合约。Web 拥有 marketplace UX。Desktop 只拥有 native plugin hooks。

## 目标行为

- 用户可以浏览 installed plugins 与 available plugins。
- 用户可以从 approved marketplace、本地路径或明确 URL 安装 plugin。
- Plugin permissions 可见、可撤销、可审计。
- Plugin updates 可检查、可执行、失败可恢复。

## API 草案

- `GET /plugins`
- `GET /plugins/marketplace`
- `POST /plugins/install`
- `POST /plugins/:name/enable`
- `POST /plugins/:name/disable`
- `POST /plugins/:name/update`
- `DELETE /plugins/:name`

## 数据模型

持久化 plugin installation records、enabled state、version、source、permission grants、diagnostics 和 capability projection snapshots。

## 验收

- 禁用 plugin 后，它的 panels、commands、routes、MCP servers、skills 在可行时无需重启即可卸载。
- Invalid plugin 显示 diagnostics，且不能注册 capabilities。
- Marketplace install 不写入其他产品 namespace。
