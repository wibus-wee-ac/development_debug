# Server Plugin Host

这个目录负责 Cradle 的服务端插件宿主。服务端插件宿主读取插件包、建立 host-owned descriptor、激活 server entry，并把插件注册的 MCP、skill、hook 等能力投影成带 owner 的 capability record。

## 文件

- **context.ts**：创建传给 server plugin entry 的 `ServerPluginContext`，并记录 owner-scoped capability registration。
- **discovery.ts**：从配置的插件目录读取 plugin package，返回有效 manifest 或无效 package diagnostics。
- **event-bus.ts**：提供 server plugin 使用的进程内 plugin event bus。
- **hooks.ts**：注册 chat lifecycle hooks，并投影插件拥有的 hook capability records。
- **index.ts**：导出 server plugin host API，供 server 其它模块使用。
- **loader.ts**：发现 plugin packages，构建 governed descriptors，激活 server entries，并把插件路由挂载到 `/api/plugins/:routeSegment`。
- **mcp-registry.ts**：保存 MCP server registrations，并投影 owner-scoped MCP capability records。
- **runtime-registry.ts**：维护 host-owned plugin descriptors、source descriptors、layer lifecycle states、route ownership 和 capability records。
- **runtime-registry.test.ts**：覆盖 identity、route collision、source classification 和 capability id 行为的 focused tests。
- **skill-registry.ts**：保存 plugin skill registrations，并投影 owner-scoped skill capability records。
- **static-server.ts**：提供 governed `/api/plugins` descriptor list 和 validated web plugin bundles。
- **storage.ts**：提供 plugin-scoped server KV storage；目前是 in-memory，等待后续持久化。
- **validation.ts**：验证 plugin module exports，并报告结构化 plugin load errors。
