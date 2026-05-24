<!-- Output: Repository-wide signal audit handoff for unclosed feature evidence. -->

# 全仓库未收口信号扫描交接

角色：`Exploration Agent D`

范围：全仓库只读扫描。除写入本交接文件外，未修改业务代码。

## 扫描命令摘要

本次扫描从 `/Users/wibus/dev/Cradle` 执行，先读取了 `docs/exec-plans/20260525-01-unclosed-feature-audit.md` 和 `AGENTS.md`，再用以下命令族做横向扫描：

```sh
git status --short
rg --files | sort
find docs/multi-work/unclosed-feature-audit -maxdepth 1 -type f -name '20260525-*.md' -print | sort
rg -n --hidden -S "TODO|FIXME|HACK|XXX|placeholder|Placeholder|not implemented|Not implemented|NotImplemented|coming soon|Coming soon|throw new Error|test\\.todo|\\.skip\\(|describe\\.skip|it\\.skip|empty catch|catch \\([^)]*\\) \\{\\s*\\}" -g '!node_modules' -g '!dist' -g '!build' -g '!out' -g '!coverage' -g '!*.lock' -g '!pnpm-lock.yaml' .
rg -n -S "TODO|FIXME|HACK|XXX|not implemented|Not implemented|NotImplemented|coming soon|Coming soon|test\\.todo|\\.skip\\(|describe\\.skip|it\\.skip" apps packages plugins e2e chronicle --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/build/**' --glob '!**/out/**' --glob '!**/coverage/**' --glob '!apps/desktop/release/**' --glob '!apps/server/dist/**'
find apps packages plugins e2e chronicle -path '*/node_modules' -prune -o -path '*/dist' -prune -o -path '*/build' -prune -o -path '*/out' -prune -o -path '*/coverage' -prune -o -path 'apps/desktop/release' -prune -o -type f \( -name '*.skip.*' -o -name '*.todo.*' \) -print | sort
rg -n "route|register|module|group\\(|get\\(|post\\(|put\\(|delete\\(" apps/server/src/app.ts apps/server/src/modules/*/index.ts apps/server/src/modules/*/README.md
rg -n "verify-preview-update|preview update|preview.*update|Velopack|delta" apps/desktop docs README.md documentations -g '!apps/desktop/release/**' -g '!docs/exec-plans/**' -g '!docs/multi-work/**'
rg -n "JsonValueSchema|ProfileConfig|AgentRuntimeConfig|ProviderConfig|provider config|config schema|RuntimeConfig|profile-config|agent-config" apps/server/src apps/web/src packages -g '!**/dist/**' -g '!**/node_modules/**'
rg -n "\\.module\\.ts|module registration|Tsuki module|Elysia|routes" apps/server/src/modules/*/README.md
```

## 筛选规则

- 排除 `apps/desktop/release/**`、`apps/server/dist/**`、`node_modules/**`、`dist/**`、`build/**`、`coverage/**` 这类构建产物或第三方依赖；初扫里这些路径贡献了绝大多数 `TODO`、`not implemented` 和空 `catch`，不代表当前源码闭环。
- 排除历史计划和审计材料，例如 `docs/exec-plans/**`、`docs/multi-work/**`、`docs/superpowers/**` 中的旧计划文本，除非它们与当前源码入口形成直接矛盾。
- 排除普通 UI 输入框 `placeholder`、测试 helper 中的 `throw new Error`、合法的防御性错误分支。
- 将信号升级为发现的门槛：必须至少满足一个条件：用户可触达入口已经存在但实现缺失；README 或 package script 明确声称能力但代码不能覆盖；同一契约在多处重复定义且字段语义已经不一致；目录文档指向不存在的关键 owner 文件，影响后续闭环验证。
- 本次未发现源码级 `test.todo`、`describe.skip`、`it.skip` 或 `*.skip.*` / `*.todo.*` 测试文件。

## 发现

### 高：preview update 验证入口暴露为通用脚本，但核心实现只支持 `darwin`

证据：

- `apps/desktop/package.json:23` 暴露 `verify:preview-distribution`。
- `apps/desktop/package.json:24` 暴露 `verify:preview-update`。
- `apps/desktop/scripts/README.md:15` 声称 distribution gate 包含 adjacent-version runtime delta verification。
- `apps/desktop/scripts/README.md:16` 声称 `verify-preview-update.mjs` 会模拟 base preview installation 并验证 delta-backed target update。
- `apps/desktop/scripts/README.md:101` 进一步说明 public gate 会运行 adjacent-version runtime delta verifier。
- `apps/desktop/scripts/verify-preview-update.mjs:155` 到 `apps/desktop/scripts/verify-preview-update.mjs:160` 中 `readLocator()` 仅在 `process.platform === 'darwin'` 时调用 `readMacLocator()`，其他平台直接抛出 `Preview update verification is not implemented for ${process.platform}`。
- `apps/desktop/scripts/verify-preview-update.mjs:222` 到 `apps/desktop/scripts/verify-preview-update.mjs:235` 会输出 `deltaCount` 等 evidence，说明该脚本是 release gate 证据链的一部分，而不是普通开发 helper。

为什么属于未收口：

`apps/desktop` 同时暴露 `dist:win`、`dist:linux`、`dist:mac`，而 `verify:preview-update` 和 `verify:preview-distribution` 没有在脚本名或 package script 上声明仅 macOS 可用。当前实现让非 macOS release/update 证据链无法闭合：入口存在，文档声称 gate 会做 runtime delta verification，但 locator 只实现了 macOS `.app` layout。

建议验证方式：

- 在非 macOS CI 或本地运行 `pnpm --filter @cradle/desktop verify:preview-update -- --release-dir <release-dir>`，确认当前直接失败在 `readLocator()`。
- 复核 release 目标是否明确只支持 macOS public preview。如果是，应在 `package.json` script、README 和 distribution gate 中显式命名为 macOS-only，避免 Windows/Linux release path 假阳性。
- 如果 Windows/Linux 也属于目标，应为 Velopack portable/install layout 增加 locator，并让 `verify-preview-distribution.mjs` 的 adjacent-version gate 覆盖对应平台。

剩余不确定性：

- 当前文档中的 public distribution gate 主要围绕 macOS Developer ID、notarization 和 `.pkg`，所以这可能是“文档和 script 命名未收口”，不一定是近期必须支持 Windows/Linux update 的产品缺口。

### 中：Agent/Profile provider config schema 在 Web、Provider runtime、Chronicle、model registry 中重复定义，字段默认值与可空语义已经漂移

证据：

- `apps/web/src/features/agent-runtime/profile-config-schema.ts:3` 到 `apps/web/src/features/agent-runtime/profile-config-schema.ts:8` 定义 `baseUrl`、`model`、`api` 默认为空字符串，`enabledModels` 为 `string[]`。
- `apps/server/src/modules/providers/provider-base.ts:3` 到 `apps/server/src/modules/providers/provider-base.ts:10` 定义 server provider base config，包含 `apiKey`、`skillPaths`、`additionalDirectories`，并将字段设为 optional。
- `apps/server/src/modules/providers/provider-base.ts:12` 到 `apps/server/src/modules/providers/provider-base.ts:22` 对 OpenAI-compatible 又把 `baseUrl`、`model` 改为 nullable default `null`，并加入 `apiMode` 和 `maxMessages`。
- `apps/server/src/modules/chronicle/service.ts:131` 到 `apps/server/src/modules/chronicle/service.ts:144` 私有定义另一个 `ProfileConfigSchema`，字段包括 `modelId`、`apiKey`、`apiMode`，但不包含 `enabledModels`、`modelRegistryMappings`、`skillPaths`。
- `apps/server/src/modules/providers/model-registry-mappings.ts:49` 到 `apps/server/src/modules/providers/model-registry-mappings.ts:58` 又定义 `ProfileConfigWithModelRegistryJsonSchema`，用 `.catchall(z.unknown())` 只强约束 `modelRegistryMappings`。

为什么属于未收口：

这不是单纯重复代码。多个功能面都在读写同一个 `profile.configJson` 语义：Settings UI、provider runtime、Chronicle summarization/profile selection、models.dev mapping。字段在不同 owner 中被局部解析，导致空字符串与 `null`、`model` 与 `modelId`、`api` 与 `apiMode`、以及 `enabledModels` / `modelRegistryMappings` 的保留行为都依赖调用点。随着 provider targets、external provider records 和 Chronicle model picker 继续演进，这会形成契约漂移：某个模块保存 config 后，另一个模块可能静默丢失或误读字段。

建议验证方式：

- 增加 contract-level fixture 测试：同一份 `configJson` 覆盖 `baseUrl: null`、`baseUrl: ""`、`model`、`modelId`、`api`、`apiMode`、`enabledModels`、`modelRegistryMappings`，分别通过 Web schema、server provider schema、Chronicle schema 和 model registry schema parse/serialize，断言字段保留和默认值一致。
- 优先提取一个 server-owned profile config contract，再让 Web 通过共享类型或 generated schema 消费；Chronicle 只能读取它需要的字段，不应重新声明整个 profile config 语义。
- 回归 Settings Providers 的编辑保存、Chronicle Settings 的 profile/model 选择、models.dev mapping 保存三条路径。

剩余不确定性：

- `.passthrough()` 和 `.catchall(z.unknown())` 能降低字段丢失风险，但不能解决默认值和字段别名语义漂移。需要运行实际保存链路才能确认是否已经产生用户可见 bug。

### 中：多个 server module README 仍描述旧 `Tsuki module/controller/service` 文件结构，当前源码已收敛为 `index.ts/model.ts/service.ts`

证据：

- `apps/server/src/modules/pack-codebase/README.md:8` 到 `apps/server/src/modules/pack-codebase/README.md:11` 声称存在 `pack-codebase.module.ts`、`pack-codebase.controller.ts`、`pack-codebase.service.ts`、`pack-codebase.engine.ts`。
- 实际入口是 `apps/server/src/modules/pack-codebase/index.ts:6` 到 `apps/server/src/modules/pack-codebase/index.ts:20` 的 Elysia plugin。
- `apps/server/src/modules/approval/README.md:9` 到 `apps/server/src/modules/approval/README.md:12` 声称存在 `approval.module.ts`、`approval.controller.ts`、`approval.types.ts`。
- 实际入口是 `apps/server/src/modules/approval/index.ts:6` 到 `apps/server/src/modules/approval/index.ts:28`。
- `apps/server/src/modules/workflow-rules/README.md:8` 到 `apps/server/src/modules/workflow-rules/README.md:12` 声称存在 `workflow-rules.module.ts`、`workflow-rules.controller.ts`、`workflow-rules.store.ts`、`workflow-rules.config.ts`。
- 实际入口是 `apps/server/src/modules/workflow-rules/index.ts:6` 到 `apps/server/src/modules/workflow-rules/index.ts:55`。
- `apps/server/src/modules/acp/README.md:8` 到 `apps/server/src/modules/acp/README.md:13` 仍声称 `acp.module.ts`、`acp.controller.ts`、`acp.store.ts`，但当前目录使用 `index.ts`、`service.ts`、`model.ts`、`acp.registry.ts`、`acp.installer.ts` 等。
- `find apps/server/src/modules -maxdepth 2 -name '*module.ts' -o -name '*.module.ts'` 未返回任何结果。

为什么属于未收口：

项目规则要求目录 README 描述文件 inventory 和 owner 边界。这里的 README 指向已经不存在的关键文件，说明 server capability migration 的文档闭环没有完成。它不会直接破坏 runtime，但会让审计、CLI metadata 追踪、owner namespace 复核和后续 refactor 找错入口。

建议验证方式：

- 对 `apps/server/src/modules/*/README.md` 运行文件 inventory 校验：README 中每个列出的文件必须存在，且新增的 `index.ts/model.ts/service.ts` 必须被描述。
- 将旧 `Tsuki module/controller` 术语替换为当前 `Elysia route/model/service` 结构，并复核 `app.ts` 中的 mount 顺序。
- 对上述模块运行对应 server tests 或 OpenAPI export，确认文档修正不掩盖真实 route 缺失。

剩余不确定性：

- 这更偏文档闭环问题，而不是功能 runtime 缺口；但由于项目把 README inventory 列为硬规则，应该纳入未收口清单。

### 低：`apps/playground` 暴露多个 component demo 入口但只有 disabled `Coming soon`

证据：

- `apps/playground/src/components/sidebar.tsx:10` 到 `apps/playground/src/components/sidebar.tsx:18` 列出 `button`、`dialog`、`input`、`select`、`tooltip`，但这些 entry 的 `available` 都是 `false`。
- `apps/playground/src/components/sidebar.tsx:101` 到 `apps/playground/src/components/sidebar.tsx:109` 对不可用 entry 渲染 disabled button 和 `Coming soon`。
- `apps/playground/src/app.tsx:9` 到 `apps/playground/src/app.tsx:10` 只导入 `DocsPage` 与 `ToolCallStreamPage`，没有对应 button/dialog/input/select/tooltip demo page。
- `find apps/playground/src/pages apps/playground/src/components -maxdepth 1 -type f -print | sort` 只看到 `docs.tsx`、`tool-call-stream.tsx`、`control-panel.tsx`、`sidebar.tsx`、`status-bar.tsx`。

为什么属于未收口：

这是一个独立 playground 应用，不是普通 app 内部 TODO。Sidebar 已经把 base UI component demo 作为可搜索条目暴露给用户，但路由/page 实现缺失，只能显示 `Coming soon`。如果 playground 的目标是设计系统验证面，这些入口会误导为设计系统组件覆盖已经规划但未闭合。

建议验证方式：

- 运行 `pnpm --filter @cradle/playground dev` 后检查 sidebar，确认这些条目不可点击且没有对应 demo。
- 决策二选一：要么补齐这些 component demo page，要么从 sidebar 中移除未排期条目，并将 roadmap 放到文档而不是可见导航。

剩余不确定性：

- 这可能是刻意保留的 playground roadmap，因此严重程度较低。若 playground 不属于发布面，可降级为维护 backlog。

## 噪音结果说明

- `placeholder` 扫描噪音极高，主要来自输入框 placeholder、文档示例和历史计划；未作为发现列出。
- `throw new Error` 扫描噪音极高，主要来自合法错误处理、测试等待 helper 和 API failure 分支；只有 `Preview update verification is not implemented` 这类直接形成入口断裂的结果升级为发现。
- 空 `catch` 的源码级高信号只有 `apps/server/src/modules/chronicle/service.ts:1142` 的 download progress listener isolation。它位于 listener fan-out 中，吞掉单个 listener 异常可以避免破坏其他订阅者；本次不判定为未收口功能。
- `apps/desktop/release/**` 和 `apps/server/dist/**` 中有大量第三方或打包后信号，已排除。

## 总体剩余不确定性

- 本次是静态横向扫描，没有启动 server、web、desktop 或 release scripts，因此所有 runtime 行为都需要按建议命令复核。
- 当前工作区已有用户改动：`apps/server/src/modules/approval/service.ts`、`apps/server/src/modules/preferences/service.ts`、`apps/server/tests/preferences.test.ts`、`apps/web/src/components/layout/app-header.tsx` 处于 modified 状态；本审计未读取 diff 细节，也未修改这些业务文件。
- 由于本节点目标是寻找其他代理可能漏掉的横向信号，发现数量刻意控制为少数高信号项；普通 TODO、历史计划遗留和纯文档草稿未展开。
