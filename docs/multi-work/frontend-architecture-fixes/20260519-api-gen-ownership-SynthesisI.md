<!--
Input: InitialG and CritiqueH API generation ownership handoffs, AGENTS.md ownership rules, and the frontend architecture fix ExecPlan.
Output: Synthesized architecture handoff for web API client generation ownership.
Position: docs/multi-work/frontend-architecture-fixes/20260519-api-gen-ownership-SynthesisI.md
-->

# API Gen Ownership SynthesisI Handoff

## 直接结论

最终推荐采用 CritiqueH 修订后的 Option 3：不要默认提交 `apps/web/src/api-gen`，也不要把手动启动 `localhost:21423` 当作正常验证路径。架构中心应是 **server-owned OpenAPI export capability**，而不是“长期存在的 schema artifact”本身。

推荐的所有权边界如下：

- `apps/server` 拥有 API contract 语义、OpenAPI document shape，以及可复用的 contract export/loading capability。
- `apps/web` 拥有 `openapi-ts` 配置、`apps/web/src/api-gen` 生成物生命周期，以及前端如何消费生成 client。
- root scripts / CI 拥有跨 package 的编排顺序：export contract、generate web client、typecheck/build web。
- `packages/cli` 不应继续长期维护一套独立的 OpenAPI loading 细节；它应复用 server-owned export/loading capability，或至少与 web generation 共享同一条 server contract 获取路径。

这意味着 schema JSON 只是 export command 的传输结果。它可以写到临时路径或 Cradle-owned generated/cache 路径供 `openapi-ts` 消费，但本轮不应先把“tracked schema artifact”提升为架构前提。

## 冲突调和

InitialG 的核心判断成立：当前状态是 fragile 的，因为 web source 直接 import `~/api-gen/*`，但 `apps/web/src/api-gen` 被 gitignore，且 root `typecheck:apps-web` / `build:web` 不会先生成 client。这个问题不能只靠文档化“先启动 server 再生成”解决。

CritiqueH 的关键修正也成立：方案不应把“server-owned schema artifact”说成唯一中心。仓库已有更强先例：`packages/cli/scripts/generate-cli.ts` 通过 `createServerApp().handle(new Request('http://localhost/openapi.json'))` 在进程内读取 OpenAPI document，并在 `finally` 中调用 `shutdownInfra()`，不依赖真实监听端口。后续应该把这类 OpenAPI loading/export 能力上移到 server-owned tooling，而不是让 CLI、web generation、live server 三处各自复制细节。

最终调和后的判断：

- 不采用 Option 1 作为默认长期方案：提交 `apps/web/src/api-gen` 会让 derived client churn 进入 review，并模糊 server contract 与 web generated cache 的边界。
- 不接受 Option 2 作为修复结果：继续依赖手动 live server 只是在保留 fresh clone / CI failure mode。
- 采用修订版 Option 3：server 提供 deterministic OpenAPI export capability，web 从 local file input 生成 ignored client，root/CI 显式编排整条链路。
- 暂缓 Option 4：没有第二个真实 consumer 前，不新增 `packages/api-client` 这类 shared package。

## 最终推荐决策

本轮 API generation ownership 的推荐决策是：

1. 保持 `apps/web/src/api-gen/` ignored。
2. 增加或抽出 server-owned OpenAPI export/loading command，优先复用现有 CLI generator 已验证的 in-process `/openapi.json` 路径。
3. `apps/web/openapi-ts.config.ts` 支持环境变量指定 local OpenAPI JSON input；保留 localhost fallback 仅作为手动开发便利路径。
4. 增加显式 root validation command，按顺序执行 server export、web generate、web typecheck/build。
5. 第一阶段不要把 generation 隐式塞进每次 `build:web`；等 export path 的性能和副作用被验证后，再决定是否让 build 自动触发 generation。
6. 若 deterministic export capability 本轮无法安全落地，不要退回“只写文档，要求手动 live server”。短期 fallback 可以是提交 generated client 或提交可验证 fixture/package，但必须附带 stale detection 和退出条件。

## 非目标

本修复 pass 不应做以下事情：

- 不修改业务 API 语义、route schema、数据库 schema、持久化格式或跨服务协议。
- 不把 server workflow 设计成直接写入 `apps/web/src/api-gen`；该目录只能由 web generation 写入。
- 不新增 shared `packages/api-client`，除非后续出现第二个明确 consumer。
- 不要求普通 web contributors 为 typecheck 手动启动 long-running dev server。
- 不在未验证副作用前把 API client generation 隐式绑定到 every `build:web`。
- 不把 tracked schema JSON 作为本轮默认结论；是否 track OpenAPI JSON 是后续 review policy 决策。
- 不依赖 `tsconfig.exclude` 来证明 generated client 未被检查。更准确地说，被 web source import 的 generated modules 仍会进入 TypeScript program；真正风险是 missing/stale generated client 以及未 import 的 generated outputs 覆盖不足。

## Rollout Steps

1. 在 frontend architecture fix plan 的 decision log 中记录本 synthesis 的最终所有权结论。

2. 在 `apps/server` 所有的 tooling 中提供 OpenAPI export/loading capability。

   目标行为：

   - 不监听真实端口。
   - 复用 server app 暴露 `/openapi.json` 的同一路径，避免 live route 与 export route 漂移。
   - success 和 failure 都执行 cleanup。
   - 尽量不要求真实 database seed、provider credentials 或用户本地 runtime state。
   - 如需要 data dir，使用临时 `CRADLE_DATA_DIR` 或明确的 Cradle-owned generated/cache location。

3. 让 `packages/cli/scripts/generate-cli.ts` 迁移或对齐到同一个 server-owned loader。

   这一步可以不和 web fix 同 commit 完成，但 ownership handoff 应明确：CLI 当前路径是设计先例，不应成为长期复制粘贴模板。

4. 更新 `apps/web/openapi-ts.config.ts` 的 input 策略。

   推荐策略：

   ```ts
   const input = process.env.CRADLE_OPENAPI_INPUT ?? 'http://localhost:21423/openapi.json'
   ```

   其中 `CRADLE_OPENAPI_INPUT` 指向 server export command 产出的 local JSON。localhost fallback 只服务手动 dev generation。

5. 增加 root-level explicit validation command。

   第一阶段建议新增类似命令，而不是改写 every `build:web`：

   ```bash
   pnpm <server-openapi-export-command>
   CRADLE_OPENAPI_INPUT=<generated-openapi-json> pnpm generate:web
   pnpm typecheck:apps-web
   pnpm build:web
   ```

   命令名称可在实现时确定，例如 `check:web-api-client` 或 `validate:web-api-client`。关键是 CI 使用它，且它从 clean / missing `apps/web/src/api-gen` 状态可恢复。

6. 定义 stale protection 的最小 guardrail。

   最小可接受策略：

   - CI 在 web typecheck/build 前强制 regenerate。
   - CI 可从 clean workspace 运行，或显式删除 `apps/web/src/api-gen` 后再生成。
   - 本地 stale cache 通过文档和 explicit command 接受。

   更强策略可以后续增加 schema hash metadata，但不应成为本轮阻塞项。

7. 更新相关 README 或 plan outcome。

   文档应说明：

   - server contract 谁负责。
   - `apps/web/src/api-gen` 谁负责。
   - local regeneration 命令。
   - CI 使用的 validation command。
   - live server fallback 的适用范围。
   - generated client 不应手动编辑。

8. 若 Phase 1 export command 无法在本 pass 安全完成，启用短期 fallback policy。

   可接受 fallback：

   - 临时提交 generated client 或 generated fixture。
   - CI 检测它与 current contract 同步。
   - 明确退出条件：server-owned export capability 稳定后，恢复 ignored generated client 策略。

   不可接受 fallback：

   - 仅补文档要求人工启动 server。
   - 保持 root validation 在 fresh clone 中可能因为缺少 `src/api-gen` 失败。

## Validation

最终实现至少应证明从 missing generated client 状态可恢复：

```bash
rm -rf apps/web/src/api-gen
pnpm <server-openapi-export-command>
CRADLE_OPENAPI_INPUT=<generated-openapi-json> pnpm generate:web
pnpm --filter @cradle/web exec tsc --noEmit
pnpm --filter @cradle/web build
```

还应运行 workflow sanity checks：

```bash
git status --short --ignored -- apps/web/src/api-gen
git diff --check -- apps/web/.gitignore apps/web/openapi-ts.config.ts apps/web/package.json package.json
```

预期结果：

- `apps/web/src/api-gen/` 仍为 ignored generated output。
- 不需要手动启动 `localhost:21423` 即可完成 CI/bootstrap mode generation。
- web typecheck/build 在 generation 后通过。
- root validation 不依赖预先存在的 local generated directory。
- server export 与 live `/openapi.json` 复用同一路径，或有测试防止两者结构漂移。
- server tooling 不直接写入 `apps/web/src/api-gen`。

建议补充验证：

- 在 clean env 或临时 `CRADLE_DATA_DIR` 下运行 export command，确认不会污染用户本地数据。
- 人为修改一个小的 server route schema，在 branch 中 export + regenerate，确认 web generated API surface 变化可预测。
- 若 tracked schema JSON 被后续采用，CI 必须在 stale diff 时失败。

## Unresolved Risks

- Server app creation 可能仍有 hidden runtime side effects，例如读取本地 config、初始化 provider、触发 database/runtime setup。export command 必须显式约束和验证这些副作用。
- Live `/openapi.json` 与 exported JSON 如果不共享同一代码路径，后续可能产生 contract drift。
- Ignored `apps/web/src/api-gen` 仍是本地 cache；CI regenerate 能解决集成正确性，但不能完全阻止开发者本地 stale client。
- `openapi-ts` 版本变化可能造成大量 generated churn。因为 client 不 tracked，review 中不一定直接看到 client surface diff，需要依赖 contract diff 或 focused validation。
- 如果后续决定 track schema JSON，review 噪音和 stale artifact 问题会转移到 schema artifact，需要单独制定 diff policy。
- 如果 export command 性能较慢或依赖 server infra 初始化，显式 validation command 的 DX 可能偏重；是否嵌入 `build:web` 应等该风险被量化后再决定。
- 当前工作树有其他 worker 修改，尤其 `apps/web/package.json` 附近可能存在并发改动；实现脚本变更时必须合并现状，不得覆盖其他 worker edits。

## 交接给实现者

实现者应把本 synthesis 当作 architecture decision，不是业务代码变更请求。最小安全落地标准是：

```bash
rm -rf apps/web/src/api-gen
pnpm <server-openapi-export-command>
CRADLE_OPENAPI_INPUT=<generated-openapi-json> pnpm generate:web
pnpm --filter @cradle/web exec tsc --noEmit
```

达不到这个标准时，不要声称 API generation ownership 已解决。宁可明确启用短期 tracked generated fallback，也不要继续保留 ignored generated files 加 implicit live-server bootstrap 的现状。
