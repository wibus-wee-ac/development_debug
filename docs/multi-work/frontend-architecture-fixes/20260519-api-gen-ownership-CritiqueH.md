# API Gen Ownership CritiqueH Handoff

## 直接结论

InitialG 的方向基本正确：`apps/web/src/api-gen` 不应在当前阶段默认提交，正常验证也不应依赖手动启动的 `localhost:21423`。但它把“server-owned schema artifact”当成推荐方案时，论证还不够完整，尤其缺少对现有 server OpenAPI 加载路径、artifact 生命周期、CI 缓存/漂移防护、以及 web 生成物可验证性的明确设计。

我建议把推荐方案收窄为：

1. 优先抽出一个 server-owned OpenAPI document loader/export command，复用当前 `packages/cli/scripts/generate-cli.ts` 已经使用的进程内 `createServerApp().handle(new Request('http://localhost/openapi.json'))` 路径。
2. `apps/web` 的 `openapi-ts` 输入应支持 deterministic local file input，但这个文件可以是临时构建产物，不必先承诺为长期 tracked artifact。
3. root/CI 应增加一个明确的 web API client validation command，顺序是 export OpenAPI document、generate web client、typecheck/build web，并在 clean workspace 中证明 `src/api-gen` 缺失时也能恢复。

## 主要问题

### 1. “schema artifact” 被推荐，但 artifact 策略没有被真正决策

InitialG 说“generate from a server-owned schema artifact”，同时又把 artifact 是否 tracked 留作后续决定。这会让方案的核心风险继续悬空：

- 如果 artifact 被 tracked，它本身就是另一个生成物，review 噪音和 stale diff 问题只是从 `apps/web/src/api-gen` 转移到 schema JSON。
- 如果 artifact 不被 tracked，fresh clone 仍然必须先运行 server export command，关键问题变成 export command 是否 deterministic、是否免 runtime env、是否在 CI 中稳定。
- 如果 artifact 放在 `apps/server` 目录下，web 读取路径是否会鼓励跨 package 直接耦合还需要定义。
- 如果 artifact 放在 repo-level cache，如 `.cradle/generated/openapi.json`，则需要清楚说明它是 root orchestration 产物，不是 server 或 web 的语义源。

更好的 refinement：把第一阶段目标定义为“server-owned OpenAPI export command”，不要把“持久 schema artifact”作为架构前提。export command 可以写到临时路径供 `openapi-ts` 消费；是否 track schema JSON 应作为独立决策，由 review 可见性和 CI drift policy 决定。

### 2. InitialG 没有利用现有 CLI 生成器的更强证据

仓库里已经有一个重要先例：`packages/cli/scripts/generate-cli.ts` 从 `apps/server/src/app` 创建 app，并用 in-process request 加载 `/openapi.json`，没有依赖真实监听端口。这个事实削弱了“必须引入一个新的 materialized schema artifact”的必要性，也提供了更小的实现路线。

风险是：如果 web 和 CLI 各自实现一套 OpenAPI 获取逻辑，未来会出现三份 contract loading 入口：

- live server `/openapi.json`
- CLI in-process loader
- web schema export command

建议 refinement：server 应拥有一个可复用的 contract loading/export 模块或脚本入口，CLI 和 web generation 都读同一个 server-owned API。至少要在 proposal 中明确：新增 web export 不应复制 `generate-cli.ts` 里的 app lifecycle 细节，而应把它上移到 server-owned tooling。

### 3. “server export 不需要 live server” 的前提没有验证 runtime side effects

InitialG 假设 server 可以 deterministic export OpenAPI document，但当前 server app creation 可能初始化 infra、读取 config、触发 provider/db/runtime side effects。现有 CLI generator 通过 `shutdownInfra()` 清理，但这不等于该路径适合 CI/web bootstrap。

需要补充的验证标准：

- export command 在 clean environment 下不要求真实 database seed、provider credentials、long-running server port。
- export command 使用临时 `CRADLE_DATA_DIR` 或无状态配置，避免污染用户本地数据。
- export command always calls server cleanup on success and failure。
- live `/openapi.json` 与 exported JSON 来自同一 app path，或者有测试比较两者结构等价。

如果这些条件不成立，Option 3 会把“需要 live server”的不稳定性换成“启动 server app 的 hidden side effects”，只是故障形态变了。

### 4. TypeScript 生成物验证的描述不够精确

InitialG 把 `apps/web/tsconfig.json` 的 `exclude: ["src/api-gen/**"]` 作为“generated files themselves are not directly typechecked”的风险。这个表述需要更精确：TypeScript 的 `exclude` 只影响 include glob 的初始文件集合，被 included source import 的 generated modules 仍会进入 program 并被检查。

真正的风险不是“imported generated internals 完全不被 typecheck”，而是：

- 如果某些 generated outputs 没有被任何 web source import，它们不会被检查。
- `src/api-gen` 缺失时，`tsc` 会直接 module-not-found；这正是 bootstrap 问题。
- 如果 generation 只在 developer machine 上偶尔运行，`tsc` 检查的是本地 stale client，而不是当前 server contract。

建议 refinement：最终验证不要依赖 `tsconfig.exclude` 的解释，而要明确执行顺序：delete or start from no `apps/web/src/api-gen`, export schema, generate client, then run web typecheck/build。

### 5. Root orchestration 的“build 是否自动生成”没有决策

InitialG 说 `build:web` should either depend on generation or CI should call a documented prebuild command before it。这是一个关键 DX/CI 决策，不能长期二选一悬着。

两种选择的 tradeoff：

- `build:web` 自动运行 generation：fresh clone UX 好，但普通 frontend build 会隐式触发 server contract export，可能变慢并引入 server tooling side effects。
- 新增 explicit command，如 `validate:web-api-client` 或 `check:web`: 可控、CI 清晰，但开发者直接跑 `pnpm build:web` 仍可能因为缺少 `src/api-gen` 失败。

我建议第一阶段采用 explicit command，并让 root `typecheck` 或 CI 调用它；不要把 generation 隐式塞进 every `build:web`，直到 export path 的性能和 side effects 被证明足够稳定。文档必须清楚说明直接 `pnpm build:web` 的前置条件，或者调整 root scripts 避免误导。

### 6. 没有定义 generated output 的 stale protection 机制

保持 `src/api-gen` ignored 会保留一个本地 stale cache。InitialG 提到了风险，但没有给出可执行 guardrail。

可执行的防护至少应包含一个：

- CI 从 clean workspace 或先删除 `apps/web/src/api-gen` 后再生成。
- root validation 在 typecheck 前强制 regenerate。
- generator 输入 schema 带 content hash，web generation command 记录 hash 到 ignored metadata，并在 dev/build 前检测 hash 是否匹配。

最小可接受方案是 CI 强制 regenerate + typecheck；本地 stale 通过文档和 explicit command 接受。更强方案才需要 hash metadata，不应在这一轮默认引入。

### 7. Option 1 被否定得略快，缺少短期 unblock 条件

长期不提交 generated client 是合理的，但如果 server export command 无法在当前 frontend architecture fix pass 内安全完成，Option 1 可能是短期 unblock CI/fresh-clone 的唯一低风险路径。InitialG 把 Option 1 定性为 weak ownership，但没有给出何时可以临时采用它。

建议补一个 fallback policy：

- 如果本轮无法提供 deterministic server export command，则不要只留下文档化 live server bootstrap。
- 短期可以选择提交 generated client 或提交一个 generated client fixture/package，条件是 CI 能检测它与 current contract 同步。
- 该 fallback 应有退出条件：一旦 server export command 稳定，回到 ignored generated client。

这样可以避免“理想 Option 3 未落地，实际继续 Option 2”的最差状态。

## 推荐修订方案

我建议把 InitialG 的 Option 3 改写为一个两阶段方案。

### Phase 1: 生成链路可重复

目标是消除 fresh clone 和 CI 对手动 live server 的依赖。

实施边界：

- `apps/server` 提供或暴露 OpenAPI export command。
- export command 复用 server app 的 `/openapi.json` 生成路径，并负责 cleanup。
- root script 编排 export、`pnpm generate:web`、web typecheck。
- `apps/web/openapi-ts.config.ts` 支持从环境变量读取 local schema path，保留 localhost fallback 仅用于手动开发。
- `apps/web/src/api-gen` 继续 ignored。

验证：

```bash
rm -rf apps/web/src/api-gen
pnpm <server-openapi-export-command>
CRADLE_OPENAPI_INPUT=<generated-openapi-json> pnpm generate:web
pnpm --filter @cradle/web exec tsc --noEmit
pnpm --filter @cradle/web build
```

### Phase 2: 漂移和 review policy

目标是决定 schema artifact 是否 tracked，以及如何让 contract changes 可审阅。

可选策略：

- 不 track schema JSON，只在 CI regenerate + typecheck。适合减少 generated churn。
- Track schema JSON but not TypeScript client。适合让 API contract diff 可见，但需要 CI fail on stale schema diff。
- Track generated client temporarily。只作为 Phase 1 无法及时落地时的 fallback。

选择标准：

- 是否需要 code review 直接看到 API contract diff。
- OpenAPI JSON diff 是否稳定、可读。
- server export command 是否足够快且无 side effects。
- CLI generator 是否也能迁移到同一个 contract loader，避免重复 ownership。

## 对 InitialG 的具体修改建议

- 把“server-owned schema artifact”改成“server-owned OpenAPI export capability”；artifact 是 export result，不是必然长期 source artifact。
- 明确引用现有 `packages/cli/scripts/generate-cli.ts` 的 in-process OpenAPI loading 作为设计先例。
- 增加 export command 的 side-effect requirements：无 port、无 provider credentials、临时 data dir、cleanup on failure。
- 把 `tsconfig.exclude` 风险改写为 stale/missing generated client 风险，避免误导 TypeScript 行为。
- 决定 root script policy：本轮至少新增 explicit validation command；是否把 generation 嵌入 `build:web` 留到 export 稳定后。
- 增加 fallback policy：如果 deterministic export 不能落地，不要接受纯文档化 live-server workflow；短期提交 generated client 比继续隐式 broken bootstrap 更诚实。

## 最终判断

InitialG 的核心方向可以保留，但不能按原文直接作为 implementation handoff。它还缺少一个关键 ownership refinement：server owns a reusable OpenAPI export capability, web owns the generated TypeScript client, root owns validation choreography. Schema artifact 是这个链路的传输格式，不应被提前提升为架构中心。

最小安全落地标准是：从没有 `apps/web/src/api-gen` 的 clean state 出发，不启动监听端口，通过 server-owned export + web generation 恢复出可 typecheck/build 的 web app。达不到这个标准时，本轮不应声称 API generation ownership 已解决。
