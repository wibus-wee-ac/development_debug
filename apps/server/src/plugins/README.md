# Server Plugin Host

这个目录负责 Cradle 的服务端插件宿主。服务端插件宿主读取插件包、建立 host-owned descriptor、激活 server entry，并把插件注册的 MCP、skill、hook 等能力投影成带 owner 的 capability record。

## 文件

- **context.ts**：创建传给 server plugin entry 的 `ServerPluginContext`，并记录 owner-scoped capability registration。
- **discovery.ts**：从配置的插件目录读取 plugin package，返回有效 manifest 或无效 package diagnostics。
- **event-bus.ts**：提供 server plugin 使用的进程内 plugin event bus。
- **external-issue-source-registry.ts**：保存插件注册的 external issue source readers；插件只读取外部系统并返回标准 snapshot，Cradle host 负责 workspace 绑定、外部 issue 投影、Kanban 只读卡片和 status overlay。
- **external-provider-source-registry.ts**：保存插件注册的 external provider source readers；插件只提供标准 snapshot，Cradle host 负责 profile/secret 投影与固定 UI。
- **hooks.ts**：注册 chat lifecycle hooks，并投影插件拥有的 hook capability records。
- **index.ts**：导出 server plugin host API，供 server 其它模块使用。
- **install-receipt.ts**：读取 plugin package 内的 Marketplace install receipt，并投影为 descriptor source provenance。
- **loader.ts**：发现 plugin packages，构建 governed descriptors，尊重 desktop fork 传入的 primary plugin source kind，激活 server entries，并把插件路由挂载到 `/api/plugins/:routeSegment`。
- **loader.test.ts**：覆盖 server plugin activation 后由 `deactivateAllPlugins()` 清理 owner-scoped registrations 和 capability records。
- **mcp-registry.ts**：保存 stdio 和 streamable HTTP MCP server registrations，并投影 owner-scoped MCP capability records；HTTP headers 只保留在 runtime config 中，不写入公开 capability metadata。
- **runtime-registry.ts**：维护 host-owned plugin descriptors、source descriptors、layer lifecycle states、route ownership 和 capability records。
- **runtime-registry.test.ts**：覆盖 identity、route collision、source classification 和 capability id 行为的 focused tests。
- **skill-registry.ts**：保存 plugin skill registrations，并投影 owner-scoped skill capability records。
- **static-server.ts**：提供 governed `/api/plugins` descriptor list 和 validated web plugin bundles。
- **storage.ts**：提供 plugin-scoped server KV storage；使用 Cradle DB 的 `plugin_storage_entries` 表，按 plugin package identity 和 key 隔离。
- **storage.test.ts**：覆盖 plugin storage 的持久化、同 key owner 隔离和删除语义。
- **validation.ts**：验证 plugin module exports，并报告结构化 plugin load errors。
