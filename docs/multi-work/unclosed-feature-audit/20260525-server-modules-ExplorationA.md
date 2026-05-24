# 服务端模块未收口功能审计交接

## 审计范围

本次审计只读检查服务端模块，不修改业务代码。覆盖范围：

- `apps/server/src/modules/**`
- `apps/server/tests/**`
- `packages/db/**`：仅在服务端模块依赖数据库 schema 时抽查

必须阅读的上下文已检查：

- `docs/exec-plans/20260525-01-unclosed-feature-audit.md`
- `AGENTS.md`
- `apps/server/AGENTS.md`
- `apps/server/README.md`

实际模块目录已逐项枚举，服务端当前生产入口是 `apps/server/src/app.ts` 的 Elysia `createServerApp()` 组合根。模块目录包括 `acp`、`agent-identity`、`approval`、`automation`、`chat-runtime`、`chronicle`、`desktop`、`external-provider-sources`、`filesystem`、`git`、`health`、`issue`、`issue-agent`、`kanban`、`observability`、`pack-codebase`、`preferences`、`profiles`、`provider-targets`、`providers`、`pty`、`search`、`secrets`、`server-events`、`session`、`session-await`、`skills`、`test-reset`、`usage`、`workflow-rules`、`workspace`。

## 审计方法

使用静态审计为主，交叉比对：

- 模块目录、`README.md`、`index.ts`、`model.ts`、`service.ts` 是否一致。
- `apps/server/src/app.ts` 是否注册模块。
- `apps/server/tests/**` 是否覆盖已暴露 route 或文档声称的 contract。
- 搜索 `TODO`、`stub`、`placeholder`、`mock`、`return []`、`not implemented`、`describe.skip`、`it.skip` 等信号。
- 对依赖持久化的模块抽查 `@cradle/db` schema、服务层查询和测试断言。

本次没有运行测试。建议验证方式在每个发现下单独列出。

## 发现

### 严重程度：高 - Chronicle builtin MCP server 被文档和 provider contract 声称，但服务端没有实际注册入口

证据：

- `apps/server/src/modules/chronicle/README.md:12` 声称存在 `mcp.ts`，负责注册 Chronicle-owned builtin MCP server，并把 `CRADLE_URL` 传给 MCP stdio process。
- `apps/server/src/modules/chronicle/README.md:13` 声称存在 `mcp-server.mjs`，提供 `memory_search`、`memory_get`、`activity_query_segments`、`activity_get_segment`、`knowledge_search`、`knowledge_get_card`。
- `apps/server/src/modules/chronicle/README.md:59` 声称 Server app 启动时注册名为 `chronicle` 的 MCP server，Claude Agent、Codex、ACP runtime 会从 shared registry 读取。
- `apps/server/src/modules/chat-runtime/README.md:42` 声称 MCP registry 同时拥有 plugin-registered servers 和 host-owned builtin servers such as Chronicle。
- `apps/server/src/modules/chat-runtime/README.md:56` 明确说 Chronicle 从 `../chronicle/mcp.ts` 注册 builtin `chronicle` MCP server。
- `apps/server/src/modules/chronicle/` 实际只有 `README.md`、`agent-context.ts`、`daemon-manager.ts`、`index.ts`、`model.ts`、`service.ts`，没有 `mcp.ts` 或 `mcp-server.mjs`。
- `apps/server/src/app.ts:120-122` 只注册 `chronicle`、`chronicleApi`、`chronicleMemoryApi` HTTP route，未调用任何 Chronicle MCP 注册函数。
- `apps/server/src/plugins/mcp-registry.ts:18-56` 的 registry 只通过 `addHostMcpServer()`、`registerHostMcpServer()` 或 plugin registration 写入；未发现 Chronicle 侧调用。
- `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts:82`、`apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts:388-390`、`apps/server/src/modules/chat-runtime/providers/codex/provider.ts:424` 都只是读取 `getRegisteredMcpServers()`。
- `apps/server/tests/acp-chat-runtime.test.ts:184-189` 和 `apps/server/tests/sdk-providers.test.ts:196-201` 只显式注册 `browser-use`；但后续测试仍期望 provider payload 中包含 `chronicle`：`apps/server/tests/acp-chat-runtime.test.ts:365-369`、`apps/server/tests/acp-chat-runtime.test.ts:413-418`、`apps/server/tests/sdk-providers.test.ts:504-507`。

为什么属于未收口：

文档和 provider contract 已经把 Chronicle MCP 描述为 agent runtime tool access 的端到端能力，但服务端模块没有拥有该能力的文件、注册生命周期或测试 setup。结果是 registry 默认不会有 `chronicle` entry，provider 只能消费已有 registry，不能自动获得 Chronicle tools。这个缺口直接破坏“已暴露或被文档声称”的 agent 长任务按需检索路径。

建议验证方式：

- 静态验证：运行 `rg -n 'addHostMcpServer|registerHostMcpServer|CRADLE_URL|mcp-server\\.mjs|mcp\\.ts|name: .chronicle.' apps/server/src apps/server/tests`，确认只有 README 和测试期望，没有生产注册。
- 行为验证：新增或临时运行一个测试，调用 `createServerApp({ startBackgroundTasks: false })` 后读取 `getRegisteredMcpServers()`，断言是否包含 `chronicle`。当前静态证据预期为不包含。
- 闭环验证：若补实现，应覆盖 ACP、Claude Agent、Codex 三个 provider 是否都能从 registry 收到 `chronicle`，并覆盖 `CRADLE_URL`、`command`、`args` 和 cleanup 生命周期。

剩余不确定性：

- 可能存在未纳入本次范围的外部 plugin 在运行时注册名为 `chronicle` 的 MCP server；但 README 声称这是 Chronicle-owned builtin server，不应依赖外部 plugin。
- `apps/server/tests/acp-chat-runtime.test.ts` 和 `apps/server/tests/sdk-providers.test.ts` 当前看起来会期望 `chronicle`，但本次未运行测试确认失败形态。

### 严重程度：中 - 多个模块 README 仍描述 Tsuki 时代文件和 store/controller，和当前 Elysia 模块生命周期不一致

证据：

- `apps/server/src/modules/acp/README.md:8-11` 列出 `acp.module.ts`、`acp.controller.ts`、`acp.service.ts`、`acp.store.ts`；实际目录为 `index.ts`、`model.ts`、`service.ts`、`acp.registry.ts`、`acp.installer.ts`。
- `apps/server/src/modules/approval/README.md:9-11` 列出 `approval.module.ts`、`approval.controller.ts`、`approval.service.ts`；实际目录为 `index.ts`、`model.ts`、`service.ts`、`approval.types.ts`。
- `apps/server/src/modules/observability/README.md:8-11` 列出 `observability.module.ts`、`observability.controller.ts`、`store.ts`；实际目录为 `index.ts`、`model.ts`、`service.ts`、`contract.ts`、`rules.ts`、`exporter.ts`、`sink.ts`。
- `apps/server/src/modules/secrets/README.md:6-10` 列出 `secrets.module.ts`、`secrets.controller.ts`、`secrets.store.ts`、`secret-cipher.ts`；实际目录为 `index.ts`、`model.ts`、`service.ts`、`types.ts`。
- `apps/server/src/modules/profiles/README.md:5-8` 列出 `profiles.module.ts`、`profiles.controller.ts`、`profiles.service.ts`、`profiles.store.ts`；实际目录为 `index.ts`、`model.ts`、`service.ts`。
- `apps/server/src/modules/providers/README.md:3` 和 `apps/server/src/modules/providers/README.md:6-9` 仍称 `providers.controller.ts`、`providers.module.ts`、`providers.store.ts`；实际目录为 Elysia `index.ts` 加 provider catalog、cache、registry 等文件。
- `apps/server/src/modules/workflow-rules/README.md:8-12` 列出 `workflow-rules.module.ts`、`workflow-rules.controller.ts`、`workflow-rules.store.ts`、`workflow-rules.config.ts`；实际目录为 `index.ts`、`model.ts`、`service.ts`。
- `apps/server/src/modules/pack-codebase/README.md:8-11` 列出 `pack-codebase.module.ts`、`pack-codebase.controller.ts`、`pack-codebase.service.ts`、`pack-codebase.engine.ts`；实际目录为 `index.ts`、`model.ts`、`service.ts`。

为什么属于未收口：

这些模块的 route 大多已在 `apps/server/src/app.ts` 注册，测试也覆盖了一部分行为，因此不是功能完全缺失。但 README 是项目要求的模块契约和文件 inventory，当前仍指向不存在的 Tsuki 文件，导致所有权边界、生命周期归属、测试复核入口不可信。对后续审计或维护者而言，这会把“HTTP contract 由谁拥有、持久化在哪里、哪些文件需要同步更新”引向错误位置。

建议验证方式：

- 静态验证：运行 `find apps/server/src/modules/<module> -maxdepth 1 -type f | sort`，逐个和对应 `README.md` 的 Files 清单比对。
- 文档闭环：按当前 Elysia 结构更新 README，只列真实存在的 `index.ts`、`model.ts`、`service.ts` 以及实际 helper 文件。
- 回归验证：文档更新后运行 `pnpm --filter @cradle/server typecheck` 或服务端现有 typecheck 命令，确认没有因路径引用或导出误解引入代码改动。

剩余不确定性：

- 这些 README 可能是迁移中间态遗留，并非运行时 bug；严重度低于 Chronicle MCP 缺失。
- 本次没有逐个确认所有 README 所声称的每条业务语义，只确认了文件 inventory 与模块生命周期明显不一致。

### 严重程度：低 - `apps/server/README.md` 的能力清单存在命名滞后，容易误导能力归属

证据：

- `apps/server/README.md:20-43` 的 `Implemented capabilities` 列出 `usage-tracking`。
- 实际模块目录为 `apps/server/src/modules/usage`，组合根为 `apps/server/src/app.ts:49` 导入 `usage`，并在 `apps/server/src/app.ts:100` 注册 `app.use(usage)`。
- `apps/server/src/modules/usage/README.md:1-13`、`apps/server/src/modules/usage/index.ts:6-77`、`apps/server/tests/usage.test.ts:30-138` 都以 `usage` capability 为当前命名。

为什么属于未收口：

这不是功能缺失，`usage` route、service 和测试整体是闭合的。但顶层 README 的能力名仍使用旧的 `usage-tracking`，和当前 module namespace 不一致。按仓库 ownership 规则，capability 名和 namespace 应清晰反映 owner；旧名会干扰审计、文档搜索和未来迁移。

建议验证方式：

- 静态验证：运行 `rg -n 'usage-tracking|usage' apps/server/README.md apps/server/src/modules/usage apps/server/tests/usage.test.ts`。
- 文档闭环：将顶层能力清单中的 `usage-tracking` 改为 `usage`，或明确说明 `usage-tracking` 是历史名称而 owner namespace 是 `usage`。

剩余不确定性：

- 可能有前端或 CLI 仍沿用 `usage-tracking` 作为展示名称；本代理只审计服务端模块范围。

## 已检查但未列为高确信问题的区域

- 模块注册：`apps/server/src/app.ts` 中实际挂载了所有生产模块目录，`test-reset` 仅在 `NODE_ENV === 'test'` 下挂载，符合测试模块边界。
- `desktop`：`apps/server/src/modules/desktop/index.ts` 暴露 `/desktop/tray` 和 `/desktop/tray/awaits`；`apps/server/src/modules/desktop/service.ts` 聚合 session、await、approval、automation、Chronicle 状态；`apps/server/tests/desktop-tray.test.ts` 覆盖 resident sessions、quick actions、pending awaits。未发现高确信假数据，但 `quickActions` 主要是 server-side projection，真实消费方不在本范围。
- `workspace`：`apps/server/src/modules/workspace/index.ts` 暴露 CRUD 和 file read/write；`apps/server/src/modules/workspace/service.ts` 对 non-Cradle-owned write 要求 `confirmedNonCradleOwnedWrite`；`apps/server/tests/workspace.test.ts` 覆盖 path duplicate、missing workspace、safe IO、未确认写入、path traversal。未列为缺口。
- `usage`：route、service、DB schema 和测试闭合；仅顶层能力命名滞后。
- `profiles` 与 `provider-targets`：当前正在变动的 provider target 相关文件存在本地改动信号，但服务端范围内 `profiles.test.ts` 已覆盖 Available Model registry mappings。未在本次静态审计中列为高确信缺口。
- `search`：发现多个合法空结果路径，例如无 query 或无数据时返回 `[]`。`apps/server/tests/search.test.ts` 覆盖 thread 与 Chronicle projection，未列为假数据。
- `chronicle` HTTP API：README 声称的 snapshot、memory、Slack、activity pipeline、privacy、dream、knowledge 等大量路径在 `apps/server/tests/chronicle.test.ts` 和 `apps/server/tests/chronicle-privacy.test.ts` 有覆盖。未逐 route 全量核对，但除 builtin MCP 外未发现高确信断层。

## 剩余风险

- 本次为静态审计，没有运行 `pnpm test`、`pnpm typecheck` 或单测，因此测试失败、OpenAPI 生成差异和 runtime-only 注册副作用未被实际验证。
- `apps/server/src/modules/chronicle/service.ts` 体量很大，已抽查关键文档声明和测试覆盖，但未逐个 HTTP route 对照 schema。
- 当前工作区存在用户已有改动，尤其 provider target/provider source 相关模块可能处在开发中；本报告只基于检查时文件内容，不回滚、不修改业务代码。
