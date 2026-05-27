<!--
Output: Diagnosis for the desktop SQLite migration failure around model_registry_mappings.
Input: Local desktop database, server log, Drizzle schema, migration journal, and desktop server startup code.
Position: Manual report for deciding the repair path without applying runtime changes.
-->

# Desktop Migration Diagnosis: model_registry_mappings

## 直接结论

Desktop 不是没有自动 migration。当前 server 启动链路会在第一次访问数据库时执行 Drizzle migration，desktop 也会把 `CRADLE_DATA_DIR` 和 migration 目录传给 fork 出来的 server。

这次 `no such table: model_registry_mappings` 的根因也不是“本地所有 migration SQL 都坏掉了”。真正的问题是：业务代码已经开始读写新的全局表 `model_registry_mappings`，但当时报错时实际 desktop DB 只应用到 `0046_workspace_pinned`，而 `model_registry_mappings` 对应的 `0047_strange_hemingway.sql` 还没有进入该 DB 的 applied migration 记录。

在本次排查过程中，实际 DB 状态发生了变化：最初检查时缺表且 `__drizzle_migrations` 只有 47 条；后续再次检查时，`0047` 已经被记录，`model_registry_mappings` 表也已经存在。这说明某个正在运行或随后启动的 dev desktop/server 进程已经用当前工作树里的 `0047_strange_hemingway.sql` 自动补跑了 migration。

## 证据

### 报错时的链路

日志里的异常来自 `apps/server/src/modules/model-registry/service.ts`：

```text
SqliteError: no such table: model_registry_mappings
at listMappings
at listMappingEntries
at getSessionRunContext
at getMessageGroups / getCapabilities / listSessionQueueItems
```

也就是说，Chat Runtime 在构造 session run context 时读取全局 model registry mapping，Drizzle 生成了针对 `model_registry_mappings` 的 SQL，但 SQLite 文件里当时没有这张表。

### Desktop 确实有自动 migration 链路

相关代码：

- `apps/desktop/src/main/server-process.ts` fork server，并设置 `CRADLE_DATA_DIR`。生产环境还会设置 `CRADLE_MIGRATIONS_DIR=process.resourcesPath/drizzle`；开发环境不设置时由 server 自己解析 `@cradle/db/paths`。
- `apps/server/src/infra.ts` 在 `ensureDbProvider()` 中创建 `MigrationRunner` 并调用 `onModuleInit()`。
- `apps/server/src/database/migration-runner.ts` 调用 `drizzle-orm/better-sqlite3/migrator` 的 `migrate(db, { migrationsFolder })`。
- `apps/server/src/database/database.provider.ts` 使用 `better-sqlite3` 打开 `cradle.db`，并开启 WAL、foreign keys 和 busy timeout。

实际 DB 也证明 migration 跑过：最初检查时已有 `__drizzle_migrations`，并且 `provider_targets`、`workspaces.pinned` 等较新的表/列已经存在。

### 当时报错时 DB 缺的是具体一张表

最初只读检查 `/Users/wibus/Library/Application Support/@cradle/desktop/data/cradle.db` 时：

- `.tables` 里没有 `model_registry_mappings`。
- `__drizzle_migrations` 有 47 条，最后 applied migration 是 `0046_workspace_pinned`。
- `provider_targets` 已存在，且有 `model_registry_mappings_json` 列。
- `workspaces` 已存在 `pinned` 列。

这排除了“desktop 完全没有自动 migration”的判断，也排除了“所有 migration 都没跑”的判断。

### 当前工作树已有补表 migration

当前工作树里有未跟踪的：

- `packages/db/drizzle/0047_strange_hemingway.sql`
- `packages/db/drizzle/meta/0047_snapshot.json`
- `packages/db/src/schema/model-registry.ts`

`0047_strange_hemingway.sql` 做了三件事：

1. 创建 `model_registry_mappings` 表。
2. 创建 `model_registry_mappings_registry_model_idx` 索引。
3. 从旧位置回填 mapping：
   - `provider_targets.model_registry_mappings_json`
   - `external_provider_runtime_targets.model_registry_mappings_json`
   - `agent_profiles.config_json -> $.modelRegistryMappings`

这说明本地已经有一份合理的修复草案，并不是 migration SQL 全部不可用。

### 当前 DB 已经被补到 0047

后续复查同一个 DB 时，状态变为：

```text
__drizzle_migrations count: 48
latest created_at: 1779815131324
table exists: model_registry_mappings
model_registry_mappings rows: 0
```

这个变化不是由本次只读 SQLite 检查造成的。更合理的解释是：某个 dev server/desktop 进程在当前工作树已经存在 `0047` 的情况下重新触发了自动 migration。

## 为什么会这样

这是一次 schema、migration 产物和运行时代码之间的时序不一致。

当业务代码引入 `apps/server/src/modules/model-registry/service.ts` 后，运行时开始依赖 `@cradle/db` 导出的 `modelRegistryMappings` 表定义。但在报错发生时，实际 desktop DB 还停留在 `0046`，没有应用创建该表的 `0047`。

本地工作树还显示相关文件处在未提交或未跟随完整发布的状态：

- `packages/db/src/schema/model-registry.ts` 是未跟踪文件。
- `packages/db/drizzle/0047_strange_hemingway.sql` 是未跟踪文件。
- `packages/db/drizzle/meta/0047_snapshot.json` 是未跟踪文件。
- `packages/db/drizzle/meta/_journal.json` 已修改，包含 `0047` journal entry。
- `packages/db/src/schema/index.ts` 已修改，导出了 `model-registry`。

所以最可能的真实过程是：

1. 代码先切到了会读取 `model_registry_mappings` 的版本。
2. 当时 desktop DB 只应用到 `0046`，没有 `0047`。
3. Chat Runtime 的 `getSessionRunContext()` 调用 `ModelRegistry.listMappingEntries()`。
4. SQLite 准备查询时发现表不存在，于是抛出 `SQLITE_ERROR`。
5. 后续某次 server 启动时，当前工作树里的 `0047` 被 Drizzle migrator 识别并应用，DB 状态恢复到有表。

这里还有一个独立的后续错误：表补上后，日志里出现了 `ReferenceError: parseTrustedJsonObject is not defined`。这已经不是 migration 问题，而是当前 `chat-runtime/service.ts` 的运行时代码问题。

## 解决方案建议

### 推荐方案：把 0047 作为正式 migration 收敛

把以下文件作为同一个变更提交或合并：

- `packages/db/src/schema/model-registry.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/0047_strange_hemingway.sql`
- `packages/db/drizzle/meta/0047_snapshot.json`
- `packages/db/drizzle/meta/_journal.json`
- `packages/db/drizzle/README.md`
- `packages/db/src/schema/README.md`

同时确认 `0047_strange_hemingway.sql` 的回填逻辑符合最终 owner 决策：新的 owner 是全局 `model-registry` namespace，旧的 provider/profile JSON 字段只是读取来源，不再作为长期写入真相源。

验证口径：

```bash
sqlite3 "/Users/wibus/Library/Application Support/@cradle/desktop/data/cradle.db" \
  "select count(*) from __drizzle_migrations;" \
  "select name from sqlite_master where type='table' and name='model_registry_mappings';" \
  "pragma table_info(model_registry_mappings);"
```

预期：

- migration count 至少包含 `0047`。
- `model_registry_mappings` 存在。
- 表结构包含 `model_id`、`registry_model_id`、`match_type`、`model_json`、`created_at`、`updated_at`。

### 需要避免的方案

不要只在 `listMappings()` 里 catch `no such table` 然后返回空数组。这会掩盖 schema drift，让运行时代码和 DB 历史继续不一致。这里应该修 migration 历史，不应该用业务层兼容分支兜底。

不要手工在用户 DB 里单独 `CREATE TABLE` 后跳过 migration journal。那会让 DB 的真实结构和 `__drizzle_migrations` 记录不一致，下一次迁移会更难判断。

## 是否说明本地 migration SQL 全坏

不说明。

当前证据显示：

- 早期到 `0046` 的 migration 已经成功在 desktop DB 上应用。
- `0047_strange_hemingway.sql` 本身能被 Drizzle migrator 应用，因为当前 DB 已经出现 `created_at=1779815131324` 的记录和 `model_registry_mappings` 表。
- 问题集中在新 feature 的 schema/migration 产物没有在报错时被实际 DB 应用，而不是整套 migration 机制失效。

更准确的描述是：这次是开发态工作树与 desktop 持久化 DB 的 schema version 临时错位。正式修复应把 `0047` 和对应 schema/README 一起收敛进代码库，并保证 desktop 启动时使用的 migration 目录包含这个 SQL。

## 当前状态备注

截至本报告写入时，同一个 desktop DB 已经有 `model_registry_mappings` 表，且 `__drizzle_migrations` 已包含 `0047`。因此原始 `no such table: model_registry_mappings` 错误在这个 DB 上应该已经不再复现。

但 server log 后续出现了新的 `parseTrustedJsonObject is not defined`，这是另一个运行时代码缺陷，需要单独处理。
