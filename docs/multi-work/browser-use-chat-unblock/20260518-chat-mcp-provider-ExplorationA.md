# Browser Use Chat MCP Provider Exploration A

## 直接结论

当前代码路径在结构上已经满足 Chat runtime / MCP plugin integration 的核心链路：

| 验收点 | 结论 |
| --- | --- |
| desktop shared config 是否到达 server plugin `sharedConfig` | 是。desktop plugin 写入 `BROWSER_BACKEND_SOCKET`，desktop server fork 注入为 `CRADLE_PLUGIN_BROWSER_BACKEND_SOCKET`，server plugin context 再还原为 `BROWSER_BACKEND_SOCKET`。 |
| `@cradle/browser-use` 是否用 `BROWSER_BACKEND_SOCKET` 注册 MCP server | 是。server plugin 仅在 socket path 存在时注册 `browser-use` MCP server，并把 `BROWSER_BACKEND_SOCKET` 放入 MCP server `env`。 |
| `ClaudeAgentProvider` 是否把已注册 MCP server 传给 Chat query options | 是。provider 调用 `getRegisteredMcpServers()` 并合并到 `queryOptions.mcpServers`，随后传给 Claude Agent SDK `query()`。 |
| future computer-use integration 缺口 | 有。MCP 注入只覆盖 Claude Agent provider；ACP provider 当前显式传空 `mcpServers`。shared config 也没有按 plugin namespace 隔离，未来多个 plugin 共享 key 时可能冲突。当前没有看到覆盖该端到端配置形状的测试。 |

## 证据链

### 1. Desktop socket path 写入 shared config

- `plugins/browser-use/src/desktop.ts:443-459`：desktop entry 在 Electron `userDataPath` 下创建 `browser-backend.sock`，随后调用 `ctx.setSharedConfig('BROWSER_BACKEND_SOCKET', socketPath)`。
- `apps/desktop/src/main/plugin-loader.ts:55-57`：desktop plugin context 的 `setSharedConfig` 直接写入模块级 `pluginSharedConfig`。
- `apps/desktop/src/main/index.ts:57-62`：desktop plugins 在 `startServer()` 之前激活，保证 shared config 在 fork server 前已经可读。

### 2. Desktop shared config 注入 server 进程环境变量

- `apps/desktop/src/main/plugin-loader.ts:16-23`：`getPluginEnvVars()` 将 shared config key 转为 `CRADLE_PLUGIN_${KEY}`，因此 `BROWSER_BACKEND_SOCKET` 会变成 `CRADLE_PLUGIN_BROWSER_BACKEND_SOCKET`。
- `apps/desktop/src/main/server-process.ts:58-67`：server child process 的 `env` 合并了 `...getPluginEnvVars()`，因此 fork 出来的 server 能读到该变量。

### 3. Server plugin context 还原 shared config

- `apps/server/src/plugins/context.ts:20-26`：server plugin context 扫描 `process.env` 中所有 `CRADLE_PLUGIN_*`，去掉前缀后写入 `sharedConfig`。因此 `CRADLE_PLUGIN_BROWSER_BACKEND_SOCKET` 会还原成 `sharedConfig.get('BROWSER_BACKEND_SOCKET')`。
- `apps/server/src/app.ts:95-96`：server app 创建时会调用 `activateServerPlugins(app)`，插件激活发生在 app bootstrap 阶段。
- `apps/server/src/plugins/loader.ts:23-35`：server plugin loader 发现 manifest 中有 server entry 的插件后，创建 `createServerPluginContext()` 并调用插件 `activate(ctx)`。

### 4. `@cradle/browser-use` 注册 MCP server 并传入 socket env

- `plugins/browser-use/package.json:6-10`：`@cradle/browser-use` 声明了 `server: "dist/server.mjs"` 和 `desktop: "dist/desktop.mjs"`，部署目标是 desktop。
- `plugins/browser-use/src/server.ts:8-18`：server plugin 从 `ctx.sharedConfig.get('BROWSER_BACKEND_SOCKET')` 读取 socket path；只有非空时才 `ctx.registerMcpServer({ name: 'browser-use', command: 'node', args: [resolve(__dirname, 'mcp-server.mjs')], env: { BROWSER_BACKEND_SOCKET: socketPath } })`。
- `plugins/browser-use/src/mcp-server.ts:107-112`：MCP server 名称为 `browser-use`，`BrowserClient` 优先使用 `process.env.BROWSER_BACKEND_SOCKET`，没有 env 时才 fallback 到硬编码 discovery path。
- 风险提示：fallback path 在 `plugins/browser-use/src/mcp-server.ts:89-102` 使用 `Cradle/browser-backend.sock`，而 desktop plugin 实际使用 Electron `userDataPath`。在 Cradle desktop 启动路径下问题不大，因为 env 会覆盖；直接独立运行 MCP server 时可能连错 socket。

### 5. MCP registry 到 Claude Agent query options

- `apps/server/src/plugins/context.ts:32-38`：`ctx.registerMcpServer()` 会调用全局 `registerMcpServer(config)`。
- `apps/server/src/plugins/mcp-registry.ts:3-16`：registry 以 MCP server name 为 key 保存配置，并由 `getRegisteredMcpServers()` 输出 `{ command, args, env }` 形状。
- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts:121-125`：`ClaudeAgentProvider` 读取 `getRegisteredMcpServers()`，非空时合并到 `queryOptions.mcpServers`。
- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts:127-141`：随后设置 query env，并调用 `query({ prompt: input.message, options: queryOptions })`。因此 Claude Agent SDK 能收到插件注册的 MCP server 配置。
- `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts:70-77`：正常情况下注册的是 `ClaudeAgentProvider`；只有 `CRADLE_MOCK_LLM_URL` 存在时使用 mock provider。

## Gaps And Risks

1. **MCP 注入只覆盖 Claude Agent provider。**
   `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts:161-164`、`176-185`、`193-200` 在 `newSession`、`loadSession`、`unstable_resumeSession` 中都传 `mcpServers: []`。如果 future computer-use 目标要覆盖 ACP agent，这条路径现在不会得到 browser-use MCP server。

2. **shared config 没有 plugin namespace 隔离。**
   `apps/desktop/src/main/plugin-loader.ts:19-20` 和 `apps/server/src/plugins/context.ts:23-24` 都使用全局 key。当前 `BROWSER_BACKEND_SOCKET` 可工作，但未来多个插件都写 `SOCKET`、`PORT`、`TOKEN` 之类 key 时会冲突，也不符合 repo AGENTS 中“namespace ownership”的原则。

3. **server plugin context 会向所有 server plugins 暴露所有 `CRADLE_PLUGIN_*`。**
   `apps/server/src/plugins/context.ts:20-26` 没有按 manifest/plugin name 过滤。browser-use 当前能读到需要的 key，但隔离性弱。未来涉及 computer-use 权限、socket、token 时风险更高。

4. **缺少端到端配置形状测试。**
   我没有在 `plugins/browser-use`、`apps/server/src/plugins`、`apps/server/src/modules/chat-runtime/providers/claude-agent` 发现现有 `*.test.ts` / `*.spec.ts`。当前结论来自代码检查，不是自动化验证。

5. **MCP server fallback path 可能掩盖 env 注入失败。**
   `plugins/browser-use/src/mcp-server.ts:112` 在 env 缺失时 fallback。如果 env bridge 回归，MCP server 仍可能启动但连向错误路径，使故障表现为工具连接失败而不是配置失败。

## Recommended Fixes

1. **为 Chat MCP bridge 添加单元测试。**
   建议覆盖以下断言：
   - desktop `getPluginEnvVars()` 将 `BROWSER_BACKEND_SOCKET` 映射为 `CRADLE_PLUGIN_BROWSER_BACKEND_SOCKET`。
   - server `createServerPluginContext()` 将 env 还原为 `sharedConfig.get('BROWSER_BACKEND_SOCKET')`。
   - browser-use server plugin 在 shared config 存在时注册 `browser-use` MCP server，且 `env.BROWSER_BACKEND_SOCKET` 等于 socket path。
   - `ClaudeAgentProvider.streamTurn()` 调用 Claude Agent SDK `query()` 时，`options.mcpServers['browser-use'].env.BROWSER_BACKEND_SOCKET` 存在且正确。

2. **把 plugin shared config 改成 namespaced contract。**
   可保留当前 key 作为兼容层，但新增更明确的映射，例如按 plugin manifest name 生成 namespace，避免不同 plugin 写同名 key。server context 应优先暴露当前 plugin 自己的 shared config。

3. **为 future computer-use 定义 provider-level MCP 注入边界。**
   如果 computer-use 只支持 Claude Agent，应在 runtime capability 或 profile 层显式表达。如果要覆盖 ACP，则 `AcpConnectionManager` 不能继续传空 `mcpServers: []`，需要复用 registry 或引入 provider-specific MCP adapter。

4. **让 browser-use MCP server 在 desktop deployment 下要求 env。**
   至少在注册路径测试中断言 env 存在。fallback discovery 可以保留给独立开发模式，但应记录为 dev-only，避免 desktop Chat 场景静默走 fallback。

## Recommended Tests

| 测试目标 | 推荐位置 | 关键断言 |
| --- | --- | --- |
| Desktop env bridge | `apps/desktop/src/main/plugin-loader.test.ts` 或现有 desktop test convention | `setSharedConfig('BROWSER_BACKEND_SOCKET', path)` 后 `getPluginEnvVars().CRADLE_PLUGIN_BROWSER_BACKEND_SOCKET === path` |
| Server sharedConfig hydration | `apps/server/src/plugins/context.test.ts` | 设置 `process.env.CRADLE_PLUGIN_BROWSER_BACKEND_SOCKET` 后，context `sharedConfig.get('BROWSER_BACKEND_SOCKET')` 正确 |
| browser-use MCP registration | `plugins/browser-use/src/server.test.ts` | shared config 有 socket 时调用 `registerMcpServer`，无 socket 时不注册 MCP server |
| Claude provider MCP query options | `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.test.ts` | mock registry 和 Claude SDK `query()`，断言 `options.mcpServers.browser-use.env.BROWSER_BACKEND_SOCKET` 透传 |
| ACP readiness guard | `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.test.ts` 或 architecture test | 若目标支持 ACP，断言 registry MCP servers 不再被丢弃；若目标不支持，断言 capability 层明确排除 |

## Notes For Merge Agent

- 本节点未修改实现文件，只新增本报告。
- 工作区在探索前已存在并行改动：`plugins/browser-use/src/desktop.ts` 为 modified，`plugins/browser-use/src/browser-commands.ts` 为 untracked，exec plan 文件也是 untracked。以上不是本节点产生的实现改动。
- 未运行测试或 build。本报告的结论基于静态代码检查和文件行号证据。
