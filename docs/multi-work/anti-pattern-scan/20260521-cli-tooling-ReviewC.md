# CLI/generated tooling anti-pattern scan

## 范围

本报告覆盖 `docs/exec-plans/20260521-04-anti-pattern-scan.md` 指定的 CLI/generated tooling 节点：

- `packages/cli/**`
- `src/cli/**`
- `packages/cli/src/commands/generated/**`
- `packages/cli/scripts/generate-cli.ts`
- `packages/cli/src/runtime/**`
- `resources/skills/cradle-cli/**`

扫描重点是 generated-first 所有权、命令注册漂移、输出格式一致性、`any`/unsafe parsing、runtime helper 边界、DRY/SOLID 风险，以及 CLI docs/tooling drift。

当前工作树状态说明：`git status --short packages/cli src/cli resources/skills/cradle-cli docs/multi-work/anti-pattern-scan` 在写报告前只显示本报告目标路径之外无 CLI 相关改动；没有发现当前 `packages/cli` 或 `src/cli` 的未提交 diff。因此下面的 finding 基于当前仓库文件内容，不是基于本轮手改。

## Findings

### 1. High: 仓库同时保留两套同名 `cradle` CLI，generated-first 所有权被旧 socket CLI 稀释

**证据**

- 根包 `bin` 指向 generated-first CLI：`package.json:6-8` 将 `cradle` 暴露为 `./packages/cli/src/index.ts`，`package.json:28-29` 的脚本也通过 `@cradle/cli` 执行 `cradle` 和 `gen:cli`。
- generated-first CLI 的入口只注册生成命令和 `man`：`packages/cli/src/index.ts:8-19` 引入 `registerGeneratedCommands`、`registerManualCommand` 并注册到 root program。
- generated-first CLI 的文档明确 `src/commands/generated` 由 `pnpm gen:cli` 从 OpenAPI 刷新，并支持统一输出格式：`packages/cli/README.md:5-15`。
- 但根级 `src/cli` 仍是另一套同名 CLI：`src/cli/README.md:5-7` 说明它是 “Standalone Node.js CLI”，通过 Unix domain socket JSON-RPC 控制 Cradle。
- 根级 `src/cli/index.ts:10-13` 也创建 `.name('cradle')` 的 Commander root；`src/cli/index.ts:17-19`、`src/cli/index.ts:88-90`、`src/cli/index.ts:234-236` 手写 `workspace`、`issue`、`agent` 等命令树。
- 旧 CLI 直接调用 JSON-RPC 方法并自行打印 JSON：`src/cli/index.ts:22-23`、`src/cli/index.ts:30-35`、`src/cli/index.ts:108-109`、`src/cli/index.ts:181-183`。
- 旧 socket transport 独立存在：`src/cli/rpc-client.ts:9-21` 解析 socket path，`src/cli/rpc-client.ts:26-66` 实现 JSON-RPC request/response。
- 旧 CLI 仍被根级 TS config 纳入检查：`tsconfig.node.json:14` 和 `tsconfig.cli.json:11` 都包含 `src/cli/**/*`。

**为什么重要**

这不是单纯 dead code。`src/cli` 仍有 README、typecheck 覆盖和完整命令树，且命令名同为 `cradle`。它绕过了 `x-cradle-cli` OpenAPI 元数据、`packages/cli/src/runtime/output.ts` 的输出约定，以及 `packages/cli/src/commands/generated/**` 的生成所有权。后续如果有人按旧文档或旧计划改 `src/cli/index.ts`，会重新引入手写命令注册、输出格式不一致和服务 API 漂移。

**推荐修复方向**

先做所有权决策，不建议局部补丁：

- 如果旧 socket CLI 已废弃：删除或归档 `src/cli/**`，从 `tsconfig.node.json`/`tsconfig.cli.json` 移除它，并更新仍引用旧入口的历史/活跃文档。
- 如果 socket CLI 仍有产品价值：改名为内部诊断工具，避免同名 `cradle`，并在 README 中明确它不承载 agent-facing/generated CLI 合约。
- 迁移仍需要的旧命令能力到 server route + `x-cradle-cli` metadata，再通过 `pnpm gen:cli` 生成。

**验证**

- `pnpm gen:cli`
- `pnpm --filter @cradle/cli typecheck`
- `pnpm typecheck:node`
- `rg -n "src/cli|workspace.resolveByPath|kanban\\.listIssues|issueAgent\\.delegateIssue" . -g '!node_modules/**'`
- `pnpm cli -- --help`，确认对外 `cradle` 只展示 generated-first 命令树。

### 2. High: 生成的 boolean flag 只能表达 true，无法表达 false 或明确 false 过滤

**证据**

- runtime 对 boolean 的解析是 `Boolean(value)`：`packages/cli/src/runtime/operation-command.ts:101-103`。
- 生成注册逻辑把 boolean flag 渲染成无值 long option：`packages/cli/src/runtime/operation-command.ts:159-162`，即 `--flag`，没有 `--no-flag` 或 `<value>`。
- 当前生成命令已经包含可选 boolean query/body：
  - `packages/cli/src/commands/generated/automation/list.ts:23-28` 的 `enabled` 是 `query.enabled` boolean。
  - `packages/cli/src/commands/generated/automation/create.ts:42-45` 的 `enabled` 是 `body.enabled` boolean。
  - `packages/cli/src/commands/generated/session/update.ts:31-34` 的 `pinned` 是 `body.pinned` boolean。
- 搜索显示生成目录内还有多处 `"type": "boolean"`，例如 `workspace/pack.ts`、`skill/import.ts`、`agent/update.ts`、`profile/set.ts`。

**为什么重要**

这是生成 runtime 的放大型 correctness bug。比如 `cradle automation list --enabled` 可以传 true，但没有稳定方式传 false 来筛选 disabled automation；`cradle session update <id> --pinned` 可以 pin，却不能 unpin。更糟的是，如果未来某个 boolean option 被改成带值输入，`Boolean("false")` 仍会得到 true，属于典型 unsafe parsing。

**推荐修复方向**

- 在 `registerOperationCommand` 中为 optional boolean 生成 `--foo` 和 `--no-foo`，或让 generator/runtime 显式建模 tri-state boolean。
- `parseValue` 不应对 string 使用 `Boolean(value)`；应只接受 true/false boolean 或严格解析 `"true"`/`"false"`。
- `setTarget` 前应区分 “option 未出现” 与 “option 出现且值为 false”，避免 false 被遗漏。
- 为 `operation-command` 增加单元测试，覆盖 body boolean false、query boolean false、未传 option 三种情况。

**验证**

- 新增/更新 `packages/cli/src/runtime/operation-command.test.ts`。
- `pnpm --filter @cradle/cli typecheck`
- 手工检查 help：`pnpm --filter @cradle/cli cradle session update --help` 应展示可表达 false 的语法。
- 以 mock context 或集成方式确认 `session update <id> --no-pinned` 发送 `{ "pinned": false }`。

### 3. Medium: command module 描述存在三份映射，新增 `automation` 已出现文档/帮助漂移

**证据**

- generator 维护一份 `moduleDescriptions`：`packages/cli/scripts/generate-cli.ts:63-85`。
- runtime 又维护一份 `describeGroup`：`packages/cli/src/runtime/operation-command.ts:21-57`。
- skill 模块表由 generator 写入，但 fallback 是泛化文案：`packages/cli/scripts/generate-cli.ts:321-329` 使用 `moduleDescriptions[moduleName] ?? 'Generated Cradle CLI module.'`。
- 当前生成索引已经注册 `automation` commands：`packages/cli/src/commands/generated/index.generated.ts:23-35`。
- 当前 skill 中 `automation` 的描述已经落到 fallback：`resources/skills/cradle-cli/SKILL.md:133-137`，其中 `automation` 行是 `Generated Cradle CLI module.`。
- runtime `describeGroup` 没有 `automation` entry：`packages/cli/src/runtime/operation-command.ts:21-57`，而 `getOrCreateGroup` 只有查到描述才设置 help 文案：`packages/cli/src/runtime/operation-command.ts:64-68`。

**为什么重要**

这属于典型 DRY/ownership smell。命令暴露由 server OpenAPI metadata 拥有，但 user-facing module 描述散落在 generator、runtime 和 generated skill 三处。新增模块时只要漏掉其中一处，就会出现 `cradle man`、`cradle <module> --help` 和 `resources/skills/cradle-cli/SKILL.md` 互相不一致。`automation` 已经是具体证据。

**推荐修复方向**

- 把 module/group 描述收敛到单一来源。可选路径：
  - 由 server route metadata 扩展出 module description，再由 generator 同时写 runtime config 和 skill block。
  - 或在 `packages/cli/scripts/generate-cli.ts` 生成一个 `module-descriptions.generated.ts`，runtime 和 skill block 都使用同一份输入。
- 短期至少补齐 `automation`，并让 generator 在 top-level module 缺少描述时失败或输出显式 warning。

**验证**

- `pnpm gen:cli`
- `rg -n "Generated Cradle CLI module" resources/skills/cradle-cli/SKILL.md`
- `pnpm --filter @cradle/cli cradle automation --help`
- `pnpm --filter @cradle/cli cradle man automation`

### 4. Medium: OpenAPI 文档在 generator 边界被直接断言为 `OpenApiDocument`，schema drift 会晚失败或生成错误命令

**证据**

- generator 自定义了很窄的 OpenAPI interface：`packages/cli/scripts/generate-cli.ts:19-52`。
- `loadOpenApiDocument` 直接把 `response.json()` cast 成 `OpenApiDocument`：`packages/cli/scripts/generate-cli.ts:232-240`。
- `collectOperations` 直接遍历 `document.paths` 和 method entries：`packages/cli/scripts/generate-cli.ts:246-272`。
- `collectFlags` 直接信任 body schema 的 `properties` 和 `required`：`packages/cli/scripts/generate-cli.ts:146-179`。

**为什么重要**

CLI generator 是生成命令和 skill module block 的源头。这里没有边界校验时，OpenAPI shape、`x-cradle-cli.command`、body schema、enum 类型或 duplicate command path 的 drift 可能表现为晚期 runtime 错误、错误 flag 类型，甚至覆盖同一生成文件。因为输出是 138 个 generated command 文件，这类错误会被放大。

**推荐修复方向**

- 在 `loadOpenApiDocument` 后增加小型 assertion layer，至少校验：
  - `paths` 是 object。
  - `x-cradle-cli.command` 是非空 string array。
  - path/query/body schema 的 `type`、`anyOf`、`enum` 是支持的形态。
  - 生成后的 command path 和 file path 没有重复。
- 对 unsupported schema type 明确 fail fast，不要默认为 string。
- 为 duplicate command、unsupported schema、missing command 写 generator 单元测试或 fixture 测试。

**验证**

- 新增 generator fixture tests。
- `pnpm gen:cli`
- `pnpm --filter @cradle/cli typecheck`
- 对 generated index 做重复检测，例如统计 `spec.command.join(" ")` 唯一性。

### 5. Low: runtime context 通过 Commander hidden option 和 unchecked cast 传递，helper 边界不清晰

**证据**

- CLI entry 在 root command 上写入 `__context`：`packages/cli/src/index.ts:21-23`。
- `getCommandContext` 从 root 读取 `__context`，只检查 truthy，然后 `as CommandContext`：`packages/cli/src/runtime/context.ts:32-42`。
- `operation-command` action 也依赖 `args.at(-1) as Command`：`packages/cli/src/runtime/operation-command.ts:174-176`。

**为什么重要**

这不是当前最严重的问题，但它把 runtime context 的所有权藏在 Commander option bag 里，并依赖 magic key `__context`。后续如果手写 command、manual command 或测试构造 Command 时漏掉 hook，错误会在 action runtime 才出现。它也让 `CommandContext` 生命周期不像一个明确的 runtime helper API。

**推荐修复方向**

- 用 `WeakMap<Command, CommandContext>` 或显式 `bindCommandContext(root, context)` / `readCommandContext(command)` helper 管理 context。
- 对读取结果做结构校验，至少确认 `request` 是 function、`serverUrl` 是 string。
- 为 command action 增加最小测试，覆盖未初始化 context 的错误路径和正常 request path。

**验证**

- 新增 runtime context 单元测试。
- `pnpm --filter @cradle/cli typecheck`
- `pnpm --filter @cradle/cli cradle health --format json` 在本地 server 可用时应继续工作。

## Checked Without Finding Issues

- **当前 CLI 相关路径无未提交 diff**：`git status --short packages/cli src/cli resources/skills/cradle-cli` 没有输出。没有证据表明本轮或当前状态中 generated files 被手工编辑后留下未提交差异。
- **生成命令文件整体模式一致**：`packages/cli/src/commands/generated/README.md:5-9` 明确目录由 `pnpm gen:cli` 刷新；抽样文件如 `packages/cli/src/commands/generated/automation/create.ts:1-83` 和 `packages/cli/src/commands/generated/session/update.ts:1-43` 都是 `const spec satisfies CliOperationSpec` + `registerOperationCommand` 的薄封装。
- **生成索引是确定性集中注册**：`packages/cli/src/commands/generated/index.generated.ts:1-5` 标注 generated barrel，`packages/cli/src/commands/generated/index.generated.ts:145-190` 开始集中调用各 generated register function。没有发现 generated command 内直接 `fetch`、直接 `console.log` 或自行解析输出格式。
- **HTTP transport helper 边界较小**：`packages/cli/src/runtime/http-client.ts:19-42` 只负责 path/query serialization，`packages/cli/src/runtime/http-client.ts:58-92` 只负责 request/response JSON；除错误 body parsing 外没有发现重复 request helper。
- **输出格式 contract 在 generated CLI 中集中实现**：`packages/cli/src/runtime/operation-command.ts:151-152` 统一添加 `--format` 和 `--json`，`packages/cli/src/runtime/output.ts:217-255` 集中处理 JSON、pretty、ndjson、table、auto。主要风险是边界行为和测试覆盖，而不是每个 generated command 自行输出。

## Uncertainties

- 没有运行 `pnpm gen:cli`。`docs/exec-plans/20260521-02-automation-platform.md:24-34` 记录过当前 `gen:cli`/CI 行为是单独问题并曾失败，因此本报告避免把 regeneration drift 断言为已验证事实。
- 没有执行 CLI runtime tests 或 typecheck。本节点是 scan/report-only，且用户要求只写指定 Markdown 文件。
- `src/cli/**` 可能仍服务某个未迁移的 desktop socket 诊断场景；本报告将其判定为所有权/命名/文档漂移风险，而不是建议无条件删除。
- `--format table` 对非数组 payload 会 fallback 到 pretty JSON：`packages/cli/src/runtime/output.ts:242-255`。这可能是有意的 forgiving behavior，也可能是 explicit format inconsistency；缺少产品约定，暂未列为正式 finding。

## Quality Gate

本报告是自包含的 CLI/generated tooling scan handoff，覆盖了指定范围内的生成器、生成命令、runtime helpers、旧 `src/cli`、root package/tsconfig 入口和 `resources/skills/cradle-cli` 文档。每个 finding 都包含 severity、精确路径和行号、证据、影响、修复方向与验证方式；已检查无问题项和不确定项已单独列出。除本报告文件外未编辑其他仓库文件。
