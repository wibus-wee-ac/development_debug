# Server/backend anti-pattern scan

## Scope

分配节点：server/backend anti-pattern scan。

已审查的路径与所有权表面：

- `apps/server/**`
- `packages/db/**` 中与后端 schema 访问相关的部分
- `apps/server/specs/**` 与 `apps/server/tests/**` 中面向后端的 specs/tests

本报告基于当前 working tree。扫描开始前 worktree 已经是 dirty 状态，因此下面的发现描述的是当前仓库现状，不假设哪些改动已经定稿。

## Method

我阅读了 `docs/exec-plans/20260521-04-anti-pattern-scan.md`，检查了 `git status --short`，并审查了 Elysia composition root、server 文档、后端模块、DB schema exports、migrations、specs 与 tests。静态搜索覆盖 raw SQL、namespace writes、helper/tooling smells、generated/OpenAPI drift、in-memory singleton state 与 stale docs。

## Findings

### 1. High: test reset 会删除 test data root 之外的用户级 Cradle skills

Evidence:

- `apps/server/src/app.ts:96` 到 `apps/server/src/app.ts:98` 在 `NODE_ENV === 'test'` 时挂载 `testReset`。
- `apps/server/src/modules/test-reset/index.ts:70` 到 `apps/server/src/modules/test-reset/index.ts:99` 暴露 `POST /test/reset`。
- `apps/server/src/modules/test-reset/index.ts:87` 到 `apps/server/src/modules/test-reset/index.ts:92` 删除 `path.join(os.homedir(), '.cradle', 'skills')`。

Why it matters:

这个 reset route 是测试工具，但它直接进入真实 user home namespace，而不是当前 `CRADLE_DATA_DIR` 或测试专属 root。任何 focused server test、generated CLI test，或者 test mode 下的本地手动调用，都可能删除 Wibus 真实的 global Cradle skills。这是隐藏的破坏性副作用，也违反 tooling 只应修改自有 namespace 的原则。

Recommended fix direction:

把 reset cleanup 绑定到 `getServerConfig().dataDir` 或显式注入的 test root。如果仍然需要 global skill cleanup，应通过 skills path resolver 提供 test-only override，并让 `/test/reset` 拒绝删除 active test data root 之外的路径。reset logic 中应避免直接使用 `os.homedir()`。

Verification:

- 新增测试：设置 `CRADLE_DATA_DIR` 为 temp directory，同时让另一个 temp home 中存在 `.cradle/skills/sentinel/SKILL.md`；调用 `POST /test/reset` 后 sentinel 必须保留。
- native SQLite 环境恢复后运行 `pnpm --filter @cradle/server test -- tests/skills.test.ts tests/elysia-skeleton.test.ts`。

### 2. High: workspace skill writes 写入标准 `.agents` namespace

Evidence:

- `apps/server/src/modules/skills/skills-paths.ts:23` 到 `apps/server/src/modules/skills/skills-paths.ts:31` 把 `workspace` scope 解析为 `path.join(context.workspacePath, '.agents', 'skills')`。
- `apps/server/src/modules/skills/skills-paths.ts:49` 到 `apps/server/src/modules/skills/skills-paths.ts:52` 只阻止写入 `builtin` 与 `legacy`，`workspace` 仍然可写。
- `apps/server/src/modules/skills/skills.store.ts:132` 到 `apps/server/src/modules/skills/skills.store.ts:149` 在解析出的 root 下创建 workspace-scope skill documents。
- `apps/server/src/modules/skills/skills.store.ts:164` 到 `apps/server/src/modules/skills/skills.store.ts:209` 更新、重命名、删除同一个 writable scope。
- `apps/server/src/modules/skills/index.ts:38` 到 `apps/server/src/modules/skills/index.ts:75` 通过 HTTP 与 `x-cradle-cli` metadata 暴露 create/update/delete。

Why it matters:

仓库级 ownership rule 明确要求 Cradle 可以读取标准 `.agents` skill data，但不应写入其他 owner 的 namespace。当前 `workspace` scope 写入 `<workspace>/.agents/skills`，这与 agent-owned skill data 无法区分，容易造成 lifecycle、migration 与 compatibility 冲突。由于这些写操作还通过 API 与 generated CLI 暴露，风险会被放大。

Recommended fix direction:

把 readable compatibility scopes 和 writable Cradle-owned scopes 分开。例如保留标准 `.agents` workspace skills 作为 read-only compatibility input，把 workspace-owned Cradle skills 写入 `<workspace>/.cradle/skills` 或 `${CRADLE_DATA_DIR}/skills/workspaces/<workspaceId>`。同步更新 skills spec、tests 与 CLI metadata，让 writable namespace 显式可见。

Verification:

- 新增 skills test：创建 workspace-scope skill 后断言 `<workspace>/.agents/skills` 下没有生成文件。
- 新增 compatibility test：`.agents/skills` 仍然可读，但 write/update/delete 被拒绝。
- 运行 `pnpm --filter @cradle/server test -- tests/skills.test.ts`。

### 3. High: FTS search path 被文档承诺，但没有 schema owner，且 dormant path 映射错误

Evidence:

- `apps/server/specs/capabilities/search.md:16` 到 `apps/server/specs/capabilities/search.md:18` 声明 search 是 FTS5-first。
- `apps/server/src/modules/search/thread-search.engine.ts:100` 到 `apps/server/src/modules/search/thread-search.engine.ts:104` 检查 `messages_fts` table。
- `apps/server/src/modules/search/thread-search.engine.ts:141` 到 `apps/server/src/modules/search/thread-search.engine.ts:143` 写入 `messages_fts`。
- `apps/server/src/modules/search/thread-search.engine.ts:202` 到 `apps/server/src/modules/search/thread-search.engine.ts:209` 查询 `messages_fts`。
- `apps/server/src/modules/search/thread-search.engine.ts:259` 到 `apps/server/src/modules/search/thread-search.engine.ts:264` 把 FTS hit 映射为 `messageRole: 'assistant'`、`messageId: String(snippet.rowid)`、`createdAt: session.updatedAt`，丢失真实 message identity 与 role。
- `packages/db/src/schema/index.ts:5` 到 `packages/db/src/schema/index.ts:17` 没有导出 search/FTS schema module；`rg "messages_fts|FTS|virtual" packages/db` 没找到 `messages_fts` 的 migration 或 schema owner。
- `apps/server/tests/search.test.ts:26` 到 `apps/server/tests/search.test.ts:135` 验证 search behavior 时没有创建 `messages_fts`，因此只证明了 fallback path。

Why it matters:

这是 generated/contract drift，也是一条 dormant correctness bug。spec 与 README 承诺 FTS-first behavior，但 fresh database 不会创建 FTS table。如果未来 migration 加上该表，当前未测试的 FTS path 会返回 synthetic message ids、硬编码 assistant role，无法正确表示 user hit。在此之前，大规模搜索会静默退回 full scan。

Recommended fix direction:

先确定 owner。要么增加 DB-owned FTS migration，并由 search module 拥有 indexing contract，存储或 join 真实 `messageId`、`role` 与 timestamp；要么在 schema 存在前移除 FTS-first 声明和 dormant FTS branch。如果 SQLite FTS 必须使用 raw migration SQL，应把 raw SQL 限制在 migration 内，并在 service 层暴露 typed functions。

Verification:

- 如果 FTS 仍是 contract，新增 fresh-DB test 断言 `messages_fts` 存在。
- 新增强制走 FTS branch 的测试，验证 user/assistant hits 保留真实 `messageId`、`messageRole` 与 `createdAt`。
- 运行 `pnpm --filter @cradle/server test -- tests/search.test.ts`。

### 4. Medium: usage service 在普通聚合查询中使用大段 runtime raw SQL

Evidence:

- `apps/server/src/modules/usage/service.ts:23` 到 `apps/server/src/modules/usage/service.ts:41` 用完整 raw SQL 实现 `getDailyUsage`。
- `apps/server/src/modules/usage/service.ts:52` 到 `apps/server/src/modules/usage/service.ts:95` 用 raw SQL 实现 summary totals、by-agent 与 by-model queries。
- `apps/server/src/modules/usage/service.ts:247` 到 `apps/server/src/modules/usage/service.ts:287` 用 raw SQL 实现 cost summary queries。
- `apps/server/src/modules/usage/service.ts:359` 到 `apps/server/src/modules/usage/service.ts:383` 用 raw SQL 实现 daily cost。
- 仓库指令要求 database interactions 使用 Drizzle，并避免 raw SQL queries，除非是 migration 或特殊 engine case。

Why it matters:

这些是 Drizzle-owned tables 上的普通 aggregate reads，不是 FTS 或 migration-only SQL。完整 raw SQL query body 把 table/column semantics 复制到 typed query builder 之外，削弱 schema refactor safety，也让 date-range handling 在多个函数里分散。

Recommended fix direction:

用 Drizzle select/group/order APIs 重写普通聚合查询。SQLite-specific date expression 可以保留为小粒度 typed `sql<number | string>` expression，但不要把完整 `SELECT ... FROM ... WHERE` query body 嵌入 runtime service。顺便集中 date-range parsing。

Verification:

- 运行 `pnpm --filter @cradle/server test -- tests/usage.test.ts`。
- 增加或更新 usage tests 覆盖 empty tables、date ranges、grouped model totals 与 local-day calculations。

### 5. Medium: plugin storage API 暴露为 storage，但实际只是 process-local

Evidence:

- `apps/server/src/plugins/storage.ts:3` 到 `apps/server/src/plugins/storage.ts:4` 说明 storage 是 in-memory，并留有 Drizzle persistence TODO。
- `apps/server/src/plugins/storage.ts:6` 到 `apps/server/src/plugins/storage.ts:24` 把所有 plugin data 存在 module-level `Map`。
- `apps/server/src/plugins/context.ts:41` 到 `apps/server/src/plugins/context.ts:44` 把该 storage 作为 `storage: createPluginStorage(manifest.name)` 暴露给 server plugins。
- `apps/server/src/plugins/loader.ts:67` 到 `apps/server/src/plugins/loader.ts:105` 激活 plugin server entries 并注入该 context。
- `packages/db/src/schema/index.ts:5` 到 `packages/db/src/schema/index.ts:17` 没有 plugin storage schema export。

Why it matters:

API 表面看起来是 plugin-scoped storage，但数据会在 server restart 后丢失，并且没有 DB schema 或 migration owner。插件是扩展点，这类宽泛 helper 很容易传播错误假设：plugin author 可能把用户设置或凭据写入 volatile map 而不自知。external plugin identities 的 lifecycle ownership 也不清晰。

Recommended fix direction:

要么把 API 重命名并文档化为 explicit volatile storage，明确 restart loss；要么新增 Cradle-owned `plugin_storage` table，以 stable plugin identity + key 为主键。若插件预计要保存 settings，优先做 DB-backed storage，并使用 Drizzle get/set/delete 与 migration metadata。

Verification:

- 新增 plugin runtime test：通过 `ctx.storage` 写入，deactivate/reactivate 或重建 context 后验证所选择的 durability contract。
- 如果选择持久化，运行 `pnpm --filter @cradle/server test -- src/plugins/runtime-registry.test.ts`。

### 6. Medium: OpenAPI 与 server architecture docs 仍描述旧 Tsuki path

Evidence:

- `apps/server/README.md:3` 到 `apps/server/README.md:5` 说 server built on Tsuki/Hono，且 Tsuki 仍拥有 production traffic。
- `apps/server/src/app.ts:64` 到 `apps/server/src/app.ts:97` 是当前实际 Elysia app composition 与 modules mount。
- `apps/server/src/openapi/README.md:1` 到 `apps/server/src/openapi/README.md:9` 引用 `AppModule` metadata、Zod-backed DTO classes 与 `openapi-routes.ts`。
- `apps/server/src/http/openapi.ts:12` 到 `apps/server/src/http/openapi.ts:30` 是当前实际 OpenAPI path，使用 `@elysia/openapi` 与 alias handler。
- `apps/server/src/modules/search/README.md:8` 到 `apps/server/src/modules/search/README.md:11` 以及 `apps/server/src/modules/skills/README.md:8` 到 `apps/server/src/modules/skills/README.md:12` 列出当前 module shape 中不存在的 Tsuki `*.module.ts` / `*.controller.ts` 文件。

Why it matters:

这不只是 stale documentation。此次 anti-pattern scan 明确关注 generated/OpenAPI drift，而这些文件会把维护者引向错误的 OpenAPI owner 和 route metadata model。后续很容易修改 dead Tsuki-era surface，而实际 generated CLI 与 OpenAPI document 已由 Elysia route metadata 驱动。

Recommended fix direction:

把 `apps/server/README.md` 改为描述 Elysia 作为当前 composition root。删除或替换 `apps/server/src/openapi/README.md`，指向 `src/http/openapi.ts`；如果 `src/openapi` 已没有有效代码，考虑删除该 stale inventory。更新 module READMEs，用 `index.ts`、`model.ts`、service/store files 替代 Tsuki module/controller files。

Verification:

- 运行 `rg -n "Tsuki|Hono|openapi-routes|\\.module\\.ts|\\.controller\\.ts" apps/server/README.md apps/server/src apps/server/specs`。
- 确认剩余命中都是有意的 compatibility notes，而不是当前架构说明。

### 7. Low: skill frontmatter parsing 存在重复且行为不一致

Evidence:

- `apps/server/src/modules/skills/skills.store.ts:383` 到 `apps/server/src/modules/skills/skills.store.ts:407` 使用 `js-yaml` 解析和序列化完整 `SKILL.md`。
- `apps/server/src/modules/skills/skill-source.store.ts:57` 到 `apps/server/src/modules/skills/skill-source.store.ts:59` 为同样的 frontmatter fields 定义 regex。
- `apps/server/src/modules/skills/skill-source.store.ts:283` 到 `apps/server/src/modules/skills/skill-source.store.ts:302` 用 regex 解析 `name` 与 `description`，而不是复用 canonical YAML parser。

Why it matters:

fetch-source preview 与 import/update 对同一个 artifact 使用不同 parser。YAML comments、quoted strings、multiline values 或包含特殊字符的值，可能在一个 flow 中可接受，在另一个 flow 中被拒绝或误读。这是较小的 DRY/SOLID 问题，但它位于用户 import 文件前依赖的 tooling path。

Recommended fix direction:

把 skill document parsing 移到 skills-owned 的单一 `skill-document` module；如果需要性能，可以提供 metadata-only read helper。`skills.store.ts` 与 `skill-source.store.ts` 都应复用同一个 helper。

Verification:

- 增加 quoted YAML、multiline descriptions、comments 与 invalid frontmatter 的测试，并同时覆盖 fetch-source 与 import paths。
- 运行 `pnpm --filter @cradle/server test -- tests/skills.test.ts`。

## Checked Without Finding Issues

- `packages/db/src/schema/automation.ts` 与 `packages/db/src/schema/chronicle.ts` 有清晰的 table ownership comments、Drizzle table definitions、indexes，并通过 `packages/db/src/schema/index.ts` 导出。
- `packages/db/drizzle/meta/_journal.json:159` 到 `packages/db/drizzle/meta/_journal.json:171` 包含当前 `0022_automation_platform` 与 `0023_yansu_style_chronicle` entries。
- `apps/server/src/modules/workflow-rules/service.ts:25` 到 `apps/server/src/modules/workflow-rules/service.ts:29` 把 workflow-rule writes 放在 active server data namespace 下，而不是 user home。
- `apps/server/src/modules/filesystem/service.ts` 有意浏览用户 filesystem paths，但不写入；本轮未发现 write-ownership 问题。
- `apps/server/src/modules/automation/poller.ts:24` 到 `apps/server/src/modules/automation/poller.ts:48` 有 module-level timer state，但 ownership 局限在 automation module，且 `apps/server/src/modules/automation/index.ts` 注册了 `onStop`；本轮未单独列为 finding。
- `apps/server/src/modules/search/thread-search.engine.ts` 对 FTS-specific operations 使用 raw SQL；如果 FTS 仍是 SQLite-owned special case，这可以被接受。上面的 finding 指向缺少 schema ownership 与 dormant mapping 错误，而不是单纯存在 FTS SQL。

## Uncertainties

- 我没有运行 server test suite。本节点目标是 scan-only ReviewA report，且既有 handoff notes 提到当前 worktree 存在 local `better-sqlite3` ABI mismatch。
- FTS table 可能存在于某个旧本地数据库中。但我没有在当前 `packages/db` schema 或 migration 中找到 owner，因此 fresh database 与 generated contract 仍受影响。
- workspace skill namespace 可能是出于 agent compatibility 有意选择。如果是这样，spec 应明确说明这是 intentional exception，并显式标注 writable owner；否则它与仓库级 namespace rule 冲突。
- 本节点没有审查 frontend 或 CLI generator implementation；只在 backend route metadata 与 OpenAPI drift 相关处做了交叉检查。

## Quality Gate

本报告是自包含、证据驱动的 server/backend 节点 handoff。内容包括 severity、精确文件路径与行号、evidence、影响、recommended fix direction、verification、checked-without-issue notes、uncertainties 与 quality-gate statement。本轮只修改了 `docs/multi-work/anti-pattern-scan/20260521-server-backend-ReviewA.md`。
