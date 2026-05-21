# Plugin External Provider Sources

本文是持续维护的 ExecPlan。随着工作推进，`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` 必须保持更新。

本文遵循 `/Users/wibus/.agents/skills/execplan/references/PLANS.md` 的 ExecPlan 要求。它是自包含的实现规格：后续执行者只需要阅读本文件，就能继续升级 Cradle Plugin SDK 与 Plugin Host，让插件以标准数据源的形式提供外部 provider，而不让插件控制 Cradle 的 Provider UI，也不把外部产品的 source reader 写进 Cradle core。

## Purpose / Big Picture

目标是让 Cradle 能通过插件读取外部 provider 配置，例如 CC Switch、Claude Desktop、Codex config 或组织级 provider registry，并把它们投影成 Cradle 可用的 provider profiles。用户完成后可以安装或启用一个 external provider source 插件，在 Cradle 固定的 Provider settings UI 中看到“来自某个外部源”的 provider，使用这些 provider 创建 agent 或 chat，同时 Cradle 仍然拥有自己的数据库、密钥、profile 生命周期和 UI 语义。

这个计划刻意不让 plugin 贡献 Provider UI。Plugin 只负责读取外部 namespace 并返回固定 shape 的 snapshot。Cradle host 负责 diff、fingerprint、credential 加密、`agent_profiles` 写入、read-only guard、stale/missing 状态和固定 UI 渲染。这样可以避免把 CC Switch 这种外部产品写成 Cradle core 的专用源，也避免把 Plugin SDK 扩展成一个过度复杂的 UI contribution framework。

实现完成后，最小可见结果是：一个测试用 external provider source plugin 返回两个 provider records；server sync 后 Cradle DB 中出现对应 mirrored `agent_profiles` 和 encrypted credentials；Web 的 Provider settings 用同一套固定 UI 展示 source label、sync status、external id、app、base URL、model、warnings 和 inventory counts；用户不能通过普通 profile edit route 修改 mirrored profile 的 source-owned 字段。

## Progress

- [x] (2026-05-21 09:37Z) 阅读 ExecPlan 规范，确认新计划必须自包含，包含 Progress、Decision Log、验证方式、接口和恢复策略。
- [x] (2026-05-21 09:37Z) 阅读当前 Plugin SDK server/web context、plugin storage、plugin loader、profile schema 和 profile service，确认当前 SDK 只有 route、MCP、skill、hook、event、KV、panel、command，尚无 external provider source contract。
- [x] (2026-05-21 09:37Z) 与 Wibus 对齐核心方向：不要让 plugin 控制 Cradle UI surface，不做 action-ref 或 descriptor UI；plugin 只提供固定 schema 的数据，Cradle 固定 UI 负责显示。
- [x] (2026-05-21 09:37Z) 创建本 ExecPlan，定义 Plugin SDK、Host projection pipeline、DB schema、固定 UI 和验证路径。
- [x] (2026-05-21 10:52Z) 实现 `@cradle/plugin-sdk/server` 中的 external provider source 类型和注册 API，保留 Web plugin API 不变。
- [x] (2026-05-21 10:52Z) 实现 server plugin host source registry、snapshot refresh、projection service、routes、DB schema 和 Drizzle migration `0035_lethal_greymalkin.sql`。
- [x] (2026-05-21 10:52Z) 扩展 profile service，阻止普通 update/delete/icon/custom-model/model-registry paths 修改 mirrored profile，并添加 projection-only `upsertMirroredProfile`。
- [x] (2026-05-21 10:52Z) 实现固定 Provider settings UI：列表显示 External badge，详情页显示 host-rendered Source section，并禁用 source-owned fields。
- [x] (2026-05-21 10:52Z) 增加 server fixture source tests，覆盖注册、refresh、projection、secret upsert、stale/missing、read-only guard 和 source error 保留旧 projection。
- [x] (2026-05-21 10:52Z) 更新相关 README 与开发者文档，说明 plugin 只能提供 data source，不拥有 Cradle Provider UI。
- [x] (2026-05-21 10:59Z) 修复两个验证阻塞点并完成宽验证：`pnpm typecheck`、`pnpm test`、`pnpm --filter @cradle/server test`、focused external-provider-sources test、plugin SDK typecheck 均通过。
- [x] (2026-05-21 11:41Z) 新增第一个真实 external provider source plugin：`plugins/cc-switch`。它注册 `cc-switch` source，读取 CC Switch SQLite/JSON，返回 host-rendered snapshot，不贡献 Provider UI。
- [x] (2026-05-21 11:45Z) 用 `plugins/cc-switch` 运行 host refresh 端到端测试，证明真实 plugin discovery 后可以通过 `/external-provider-sources/:sourceKey/refresh` 投影 fake CC Switch provider 到 read-only profile，并且 profile response 不暴露 fake secret。

## Surprises & Discoveries

- Observation: 当前 `packages/plugin-sdk/src/server.ts` 的 `ServerPluginContext` 只提供 scoped Elysia app、MCP server registration、skill registration、plugin storage、logger、shared config、chat hooks 和 event bus。
  Evidence: `packages/plugin-sdk/src/server.ts` 中 `ServerPluginContext` 没有 profile、secret、external source、scheduler 或 file watch API。

- Observation: 当前 server plugin storage 文档注释称为 persistent KV，但实现是进程内 `Map`，不能保存 external source fingerprint、last sync status 或 stable credential mapping。
  Evidence: `apps/server/src/plugins/storage.ts` 使用 `const memoryStore = new Map<string, Map<string, string>>()`，并有 TODO 指向未来 Drizzle-backed `plugin_storage`。

- Observation: 当前 Web plugin 可以注册 panel 和 command，意味着它适合独立 inspector 页面，但不适合控制 Provider settings 的局部 UI。
  Evidence: `apps/web/src/lib/plugin-host.ts` 的 `createWebPluginContext` 只暴露 `registerPanel`、`registerCommand`、`storage` 和 `logger`。

- Observation: Cradle provider profile 的运行时依赖是 `agent_profiles` 和 `agent_credentials`，而不是一个纯虚拟列表。
  Evidence: `packages/db/src/schema/identity.ts` 定义 `agentProfiles` 和 `agentCredentials`，`agents.agentProfileId` 外键引用 `agentProfiles.id`。

- Observation: `pnpm --filter @cradle/web exec tsc --noEmit` 当前仍失败，但失败点在既有 `src/features/chat/use-chat-session-binding.test.tsx` tuple/mock typing，与本次 agent-management UI 改动无关。
  Evidence: 命令只报告 `use-chat-session-binding.test.tsx` 第 185、189、199 行；修复本次 `profile-detail-panel.tsx` 的 `unknown` ReactNode 类型后不再出现本次文件错误。后续小范围修复该 test mock call typing 后，`pnpm --filter @cradle/web exec tsc --noEmit` 和 `pnpm typecheck` 均通过。

- Observation: `pnpm --filter @cradle/server test -- external-provider-sources` 会被当前 script 参数处理成整套 server test run，并暴露既有 chronicle daemon manager 断言失败。
  Evidence: 整套 run 中失败为 `tests/chronicle-daemon-manager.test.ts`，期望参数缺少 `--audio-source undefined`；直接运行 `pnpm --filter @cradle/server exec vitest run tests/external-provider-sources.test.ts` 通过。后续将 chronicle daemon manager test 补齐 explicit `audioSource: 'microphone'` 后，`pnpm --filter @cradle/server test` 通过。

## Decision Log

- Decision: External provider source 作为 Plugin SDK/Host 架构升级实现，不把 CC Switch reader 写进 Cradle core。
  Rationale: Cradle 的 namespace ownership 原则允许读取外部 namespace，但不应把某个外部产品的 source-specific logic 混入 core。Core 应拥有通用 projection 语义，plugin 拥有外部 reader。
  Date/Author: 2026-05-21 / Codex.

- Decision: Plugin 不贡献 Provider settings UI，不提供 React component、surface descriptor、action ref 或 arbitrary JSON block。
  Rationale: Provider UI 是 Cradle 产品语义的一部分，应由 Cradle design system 和固定布局控制。Plugin UI contribution 会提高 SDK 复杂度，并把 permission、loading、error、layout 和长期兼容性问题扩散到插件作者。
  Date/Author: 2026-05-21 / Codex.

- Decision: Plugin 只注册 `ExternalProviderSource` 并返回固定 `ExternalProviderSourceSnapshot`。
  Rationale: 固定 schema 能让 host 做类型校验、权限控制、CLI/OpenAPI 输出、UI 复用和向后兼容。Plugin 可以不提供可选字段；Cradle 有预制 UI 显示它提供的数据。
  Date/Author: 2026-05-21 / Codex.

- Decision: Plugin 不直接写 `agent_profiles`、`agent_credentials` 或新增 DB tables。
  Rationale: Profile 和 credential 是 Cradle-owned lifecycle。Host 必须在一个事务中处理 projection、secret encryption、missing/stale 状态和 audit metadata，否则会绕过 profile route guard、secret service 和未来 CLI/OpenAPI 语义。
  Date/Author: 2026-05-21 / Codex.

- Decision: External source persistence 放在 Cradle DB 中，plugin storage 不参与 source truth。
  Rationale: 当前 plugin storage 是内存实现，即使未来持久化，它也只适合 plugin-local preferences。External profile projection 是 host-owned state，应由 Cradle schema、migration 和 service 维护。
  Date/Author: 2026-05-21 / Codex.

- Decision: Fixed UI 的第一版只显示 source status、record metadata、warnings、inventory counts 和 host-owned refresh/import controls，不允许 plugin 自定义按钮位置或布局。
  Rationale: 这满足当前 CC Switch 需求，同时避免提前设计通用 UI DSL。若未来真实插件需要复杂页面，仍可使用现有 `registerPanel` 做独立 inspector。
  Date/Author: 2026-05-21 / Codex.

- Decision: 第一版不为 external provider source routes 添加 `x-cradle-cli` metadata。
  Rationale: 这些 routes 是 host-owned management API，还没有稳定 CLI UX。避免把本次 Plugin SDK/Host 升级扩大到 generated CLI artifacts；后续 CLI 可以在 API 语义稳定后单独设计。
  Date/Author: 2026-05-21 / Codex.

- Decision: CC Switch adapter 作为 `plugins/cc-switch` 实现，而不是放入 `apps/server/src/modules/external-provider-sources`。
  Rationale: Host 已拥有 profile/secret projection 和固定 UI；source-specific SQLite/JSON reader 属于外部 connector 责任。插件只返回固定 snapshot，符合 Wibus 对低复杂度 Plugin API 的要求。
  Date/Author: 2026-05-21 / Codex.

## Outcomes & Retrospective

第一版 Host 能力已完成。Cradle core 不内置 CC Switch source，Plugin 也不直接控制 Provider UI；server plugin 现在可以注册 fixed-shape external provider source，host 会把 snapshot 投影进 Cradle-owned `agent_profiles`、`agent_credentials` 和 external source tracking tables。Provider settings 使用固定 UI 展示 external source metadata，并禁用 source-owned edits。后续新增的 `plugins/cc-switch` 是第一条真实 adapter，已完成 plugin-local reader/mapping/fake DB tests，并补齐 host discovery + refresh 端到端测试。CC Switch mirror 仍需扩展更新、删除、锁定和旧 schema 兼容验证。

已验证 `pnpm --filter @cradle/plugin-sdk typecheck`、`pnpm --filter @cradle/server exec tsc --noEmit`、`pnpm --filter @cradle/server exec vitest run tests/external-provider-sources.test.ts`、`pnpm --filter @cradle/server test`、`pnpm --filter @cradle/web exec tsc --noEmit`、`pnpm typecheck` 和 `pnpm test` 均通过。

## Context and Orientation

Cradle 是一个 TypeScript/React/Electron 应用。前端主要在 `apps/web`，server 在 `apps/server`，数据库 schema 在 `packages/db/src/schema`，Plugin SDK 在 `packages/plugin-sdk/src`。Provider profile 是 Cradle 中描述“一个可供 agent runtime 使用的模型服务配置”的对象。当前 profile 存在 `agent_profiles` 表，密钥存在 `agent_credentials` 表。Agent 通过 `agents.agentProfileId` 引用 profile，所以可运行 provider 不能只是 plugin 返回的临时虚拟对象。

Plugin SDK 当前分三层。Server plugin 通过 `packages/plugin-sdk/src/server.ts` 的 `ServerPluginContext` 注册 HTTP routes、MCP servers、skills、chat hooks 和 events。Web plugin 通过 `packages/plugin-sdk/src/web.ts` 注册独立 panel 和 command。Desktop plugin 位于 `packages/plugin-sdk/src/desktop.ts`，可以参与 Electron main 侧能力。Server plugin activation 在 `apps/server/src/plugins/loader.ts`，host context 在 `apps/server/src/plugins/context.ts`。

本文中的 external provider source 指“一个由 plugin 提供的外部 provider 数据源”。例如 CC Switch plugin 可以读取 `~/.cc-switch/cc-switch.db`，并返回 provider records；Claude Desktop plugin 可以读取 Claude Desktop config；组织 registry plugin 可以调用企业内部 API。External provider source 不等于 Cradle provider profile。Source 是外部事实的读取者，profile 是 Cradle 自己数据库里的投影。

本文中的 snapshot 指 source 在某个时间点读到的一组标准化 records。Snapshot 是数据，不是 UI。Host 会校验 snapshot，计算 fingerprint，然后把可运行 provider record 投影进 `agent_profiles` 和 `agent_credentials`。

本文中的 mirrored profile 指 Cradle DB 中由 external source 投影出来的 `agent_profiles` row。它属于 Cradle DB namespace，但它的 source-owned 字段由 source refresh 覆盖。用户不能通过普通 edit form 修改这些字段；如需改变外部 provider，应去原外部产品修改，或选择显式 import as native 的后续能力。

## Plan of Work

第一阶段扩展 SDK 类型，但保持 plugin 作者接口很小。修改 `packages/plugin-sdk/src/server.ts`，在 `ServerPluginContext` 中新增 `externalProviderSources: ExternalProviderSourceRegistry`。这个 registry 只暴露 `register(source)`。Source 必须提供稳定 `id`、`label`、可选 `description`、可选 `capabilities` 和 `readSnapshot(ctx)`。不要在 SDK 中加入 UI surface、React component、descriptor block 或 arbitrary action ref。

第二阶段在 server host 实现 source registry 和 refresh pipeline。新增 `apps/server/src/plugins/external-provider-source-registry.ts`，保存当前进程已注册的 sources。修改 `apps/server/src/plugins/context.ts`，把 `externalProviderSources.register` 注入 plugin context，并把 owner plugin name 绑定到每个 source 上。修改 `apps/server/src/plugins/loader.ts`，在 plugin reload 前重置 registry，避免重复注册。

第三阶段新增 host-owned DB schema。修改 `packages/db/src/schema/identity.ts` 或新增 `packages/db/src/schema/external-sources.ts` 并从 `packages/db/src/schema/index.ts` 导出。建议独立文件 `external-sources.ts`，因为它是跨 plugin 和 profile 的 host capability。新增三张表：`external_provider_sources`、`external_provider_records`、`external_provider_profile_links`。如果需要保存 generic inventory，可以加 `external_source_inventory_items`，但第一版只需要 source-level JSON counts 即可。生成 Drizzle migration，并保持所有 writes 在 Cradle namespace。

第四阶段实现 projection service。新增 `apps/server/src/modules/external-provider-sources` 模块，包含 `model.ts`、`service.ts`、`index.ts` 和 `README.md`。Service 提供 `listSources()`、`refreshSource(sourceKey)`、`refreshAllSources()`、`listExternalRecords()` 和 `getProfileExternalLink(profileId)`。Projection service 从 registry 调用 source 的 `readSnapshot`，校验 snapshot，把 credential 交给 secrets service 加密或更新，把 provider record upsert 到 `agent_profiles`，并记录 external link 和 fingerprint。Projection service 不信任 plugin 传入的 profile id；stable profile id 由 host 根据 `pluginName/sourceId/externalId` 派生。

第五阶段扩展 profile service 的 read-only guard。修改 `apps/server/src/modules/profiles/service.ts`，在 `upsertProfile`、`updateIcon`、`updateCustomModels`、`updateModelRegistryMapping` 和 `removeProfile` 前检查 profile 是否存在 external link。第一版规则是：普通 profile edit route 不能修改 mirrored profile 的 source-owned 字段，包括 name、providerKind、configJson、credentialRef、enabled、customModels。允许 icon 或 model registry mapping 是否可编辑需要产品决策；本计划建议第一版全部禁止，避免用户误以为能编辑外部 source。Projection service 自己使用 internal function 更新 mirrored profiles，绕过 public guard，但必须只在 refresh transaction 内调用。

第六阶段新增 fixed UI。修改 `apps/web/src/features/agent-management/agent-runtime-settings.tsx` 和 `apps/web/src/features/agent-management/profile-detail-panel.tsx`，通过 server API 获取 external source metadata。Provider list 行显示固定 badge，例如 “External · CC Switch”。Detail panel 显示固定 Source section，字段包括 source label、external id、app、last sync、fingerprint status、base URL、model、health、warnings 和 inventory counts。不要允许 plugin 自定义该 section。UI 必须遵循 design system，Tailwind classes 静态定义，用 `cn()` 合并条件 class。

第七阶段添加 server routes 和 OpenAPI/CLI follow-up。External source routes 建议放在 `/external-provider-sources`，而不是 `/api/plugins/<plugin>`，因为这是 host-owned capability。Routes 包括 `GET /external-provider-sources`、`POST /external-provider-sources/:sourceKey/refresh`、`GET /external-provider-sources/records` 和 `GET /profiles/:id/external-source`。如果当前 OpenAPI/CLI generator 要求模块 README 或 command metadata，按现有 server module 规范补齐；否则先在 README 记录待办。

第八阶段用 fixture plugin 验证。创建一个 workspace dev plugin，例如 `plugins/fixture-external-provider-source`，它注册 `fixture-providers` source，返回两个 records：一个 Anthropic-compatible provider，一个 OpenAI-compatible provider。Fixture 不读取真实外部文件，不含真实密钥。测试使用固定 fake secret，例如 `test-secret-value`，只验证 host 写入 encrypted credential，不打印 secret。

第九阶段更新文档。修改 `packages/plugin-sdk/DEVELOPERS.md`、`apps/server/src/plugins/README.md`、`apps/server/src/modules/profiles/README.md`、新增模块 README，并在 `docs/exec-plans/20260521-05-cc-switch-provider-mirror.md` 的后续实施中引用本计划，说明 CC Switch 应作为 external provider source plugin，而不是 core source。

## Concrete Steps

从仓库根目录 `/Users/wibus/dev/Cradle` 开始。先确认工作区状态，避免覆盖未理解的改动：

    git status --short

阅读当前相关文件：

    sed -n '1,220p' packages/plugin-sdk/src/server.ts
    sed -n '1,220p' apps/server/src/plugins/context.ts
    sed -n '1,220p' apps/server/src/plugins/loader.ts
    sed -n '1,220p' packages/db/src/schema/identity.ts
    sed -n '1,260p' apps/server/src/modules/profiles/service.ts
    sed -n '1,220p' apps/web/src/features/agent-management/profile-detail-panel.tsx

实现 SDK 类型。编辑 `packages/plugin-sdk/src/server.ts`，添加以下接口。实际代码应保持 English identifiers 和 comments。

    export interface ExternalProviderSourceRegistry {
      register(source: ExternalProviderSource): Disposable
    }

    export interface ExternalProviderSource {
      id: string
      label: string
      description?: string
      capabilities?: ExternalProviderSourceCapabilities
      readSnapshot(ctx: ExternalProviderSourceReadContext): Promise<ExternalProviderSourceSnapshot>
    }

    export interface ExternalProviderSourceCapabilities {
      refresh?: boolean
      revealSourceFile?: boolean
      importAsNative?: boolean
    }

    export interface ExternalProviderSourceReadContext {
      signal: AbortSignal
      logger: Logger
      sharedConfig: ReadonlyMap<string, string>
    }

    export interface ExternalProviderSourceSnapshot {
      source: ExternalProviderSourceSnapshotInfo
      providers: ExternalProviderRecord[]
      inventory?: ExternalProviderInventory
      warnings?: ExternalProviderWarning[]
    }

    export interface ExternalProviderSourceSnapshotInfo {
      status: 'ok' | 'warning' | 'error'
      message?: string
      observedAt?: string
    }

    export interface ExternalProviderRecord {
      externalId: string
      app: string
      name: string
      providerKind: 'anthropic' | 'openai-compatible'
      config: Record<string, unknown>
      credential?: ExternalProviderCredential
      current?: boolean
      enabled?: boolean
      readonly?: boolean
      metadata?: ExternalProviderRecordMetadata
      warnings?: ExternalProviderWarning[]
    }

    export interface ExternalProviderCredential {
      kind: 'api-key'
      value: string
      label?: string
    }

    export interface ExternalProviderRecordMetadata {
      baseUrl?: string
      model?: string
      apiFormat?: string
      health?: 'healthy' | 'unhealthy' | 'unknown'
      sourceUpdatedAt?: string
      rawFingerprintHint?: string
    }

    export interface ExternalProviderInventory {
      mcpServers?: number
      prompts?: number
      skills?: number
      usageRollups?: number
      modelPricingEntries?: number
    }

    export interface ExternalProviderWarning {
      code: string
      message: string
      severity: 'info' | 'warning' | 'error'
    }

实现 registry。新增 `apps/server/src/plugins/external-provider-source-registry.ts`，提供 `registerExternalProviderSource(owner, source)`、`listExternalProviderSources()`、`getExternalProviderSource(sourceKey)` 和 `resetExternalProviderSourceRegistry()`。`sourceKey` 使用 host 派生的稳定值，例如 `${owner}:${source.id}`。Registry 必须拒绝同一 owner 下重复 source id，并记录为 plugin activation error 或 warning。

修改 `apps/server/src/plugins/context.ts`，在 `createServerPluginContext` 的返回值中加入：

    externalProviderSources: {
      register(source) {
        return registerExternalProviderSource(manifest.name, source)
      },
    }

修改 `apps/server/src/plugins/loader.ts`，在 `resetPluginRuntimeRegistry()` 附近调用 `resetExternalProviderSourceRegistry()`。

新增 DB schema。建议创建 `packages/db/src/schema/external-sources.ts`：

    export const externalProviderSources = sqliteTable('external_provider_sources', {
      id: textPk(),
      pluginName: text('plugin_name').notNull(),
      sourceId: text('source_id').notNull(),
      label: text('label').notNull(),
      enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
      capabilitiesJson: text('capabilities_json').notNull().default('{}'),
      inventoryJson: text('inventory_json').notNull().default('{}'),
      lastSyncStatus: text('last_sync_status', { enum: ['never', 'ok', 'warning', 'error'] }).notNull().default('never'),
      lastSyncMessage: text('last_sync_message'),
      lastSyncError: text('last_sync_error'),
      lastSyncAt: int('last_sync_at'),
      ...timestamps(),
    })

    export const externalProviderRecords = sqliteTable('external_provider_records', {
      id: textPk(),
      sourceKey: text('source_key').notNull(),
      externalId: text('external_id').notNull(),
      app: text('app').notNull(),
      name: text('name').notNull(),
      providerKind: text('provider_kind', { enum: ['openai-compatible', 'anthropic'] }).notNull(),
      status: text('status', { enum: ['active', 'stale', 'missing', 'unsupported', 'error'] }).notNull().default('active'),
      fingerprint: text('fingerprint').notNull(),
      metadataJson: text('metadata_json').notNull().default('{}'),
      warningsJson: text('warnings_json').notNull().default('[]'),
      lastSeenAt: int('last_seen_at').notNull(),
      ...timestamps(),
    })

    export const externalProviderProfileLinks = sqliteTable('external_provider_profile_links', {
      id: textPk(),
      sourceKey: text('source_key').notNull(),
      externalRecordId: text('external_record_id').notNull(),
      profileId: text('profile_id').notNull().references(() => agentProfiles.id, { onDelete: 'restrict' }),
      credentialRef: text('credential_ref'),
      sourceOwnedFieldsJson: text('source_owned_fields_json').notNull().default('[]'),
      lastProjectedFingerprint: text('last_projected_fingerprint').notNull(),
      ...timestamps(),
    })

Add unique indexes on `(plugin_name, source_id)`, `(source_key, external_id)`, and `profile_id`. Use Drizzle's existing project style for index definitions. Export the schema from `packages/db/src/schema/index.ts`, generate a migration with the repo's Drizzle command if available, and inspect the generated SQL before committing.

实现 projection service。新增 `apps/server/src/modules/external-provider-sources/service.ts`。Important functions:

    export function listExternalProviderSources(): ExternalProviderSourceView[]
    export async function refreshExternalProviderSource(sourceKey: string): Promise<ExternalProviderRefreshResult>
    export async function refreshAllExternalProviderSources(): Promise<ExternalProviderRefreshResult[]>
    export function getExternalProfileLink(profileId: string): ExternalProfileLinkView | null
    export function isExternalProfile(profileId: string): boolean

Projection rules:

1. Validate snapshot before any DB write. Reject records missing `externalId`, `app`, `name`, `providerKind`, or `config`.
2. Compute record fingerprint from normalized JSON of `app`, `name`, `providerKind`, `config`, `credential.kind`, `credential.value`, `metadata`, `warnings`, `enabled`, `current`, and `readonly`. Use stable key ordering. Do not include transient `observedAt`.
3. Derive stable profile id from source key and external id, for example `external:${sha256(sourceKey + ':' + externalId).slice(0, 24)}`. Keep the exact algorithm in one helper.
4. If credential exists, call a host-owned secret service helper to upsert encrypted credential by stable external credential id. Do not write plaintext into `agent_profiles.configJson`.
5. Upsert `agent_profiles` with source-owned fields. `enabled` defaults to true unless record enabled is false or status is unsupported/error.
6. Upsert `external_provider_records` and `external_provider_profile_links`.
7. Mark records from the same source that were not seen in the latest successful snapshot as `missing`, and disable their profiles unless they are already explicitly imported as native in a future implementation.
8. If source read fails, update `external_provider_sources.lastSyncStatus` to `error` and keep previous profiles enabled unless the source explicitly returns provider-level error records. A transient read failure should not delete or disable working profiles.

实现 routes。新增 `apps/server/src/modules/external-provider-sources/index.ts`，按当前 server module conventions 注册 routes。If this repository currently wires Elysia modules manually, follow the adjacent modules' style. Routes:

    GET /external-provider-sources
    POST /external-provider-sources/:sourceKey/refresh
    POST /external-provider-sources/refresh
    GET /external-provider-sources/records
    GET /profiles/:id/external-source

Update app composition where modules are registered. The route output must redact secrets. Never return `credential.value`.

修改 profile guard。In `apps/server/src/modules/profiles/service.ts`, add internal projection-only helpers instead of letting projection service call public `upsertProfile`. Suggested split:

    export function upsertProfile(input: UpsertProfileInput): AgentProfile {
      assertProfileEditable(input.id)
      return writeProfile(input)
    }

    export function upsertMirroredProfile(input: UpsertProfileInput): AgentProfile {
      return writeProfile(input)
    }

    function writeProfile(input: UpsertProfileInput): AgentProfile {
      ...
    }

`assertProfileEditable` should call `isExternalProfile(profileId)` from the external provider sources module. Avoid circular imports by placing shared DB query helpers in a low-level file such as `apps/server/src/modules/external-provider-sources/profile-link-store.ts`, or by injecting guard dependency through service composition if the module system supports it.

修改 Web UI。In `apps/web/src/features/agent-management/agent-runtime-settings.tsx`, fetch external source metadata together with profiles or through a dedicated hook. In `profile-detail-panel.tsx`, when a selected profile has external source metadata, render a fixed read-only section above editable fields and disable source-owned inputs. Static UI should display:

- source label and status
- external id
- app
- last sync timestamp
- base URL if available
- model if available
- health if available
- warnings
- inventory counts at source level

Do not allow plugin to inject arbitrary rows. If optional fields are absent, omit those rows. Keep all Tailwind classes static and use `cn()` for conditionals.

新增 fixture plugin and tests. Create a workspace test plugin under `plugins/fixture-external-provider-source` or a test-only fixture under `apps/server/src/plugins/__fixtures__`, depending on existing test conventions. It should register:

    ctx.externalProviderSources.register({
      id: 'fixture-providers',
      label: 'Fixture Providers',
      async readSnapshot() {
        return {
          source: { status: 'ok', observedAt: '2026-05-21T09:37:00Z' },
          inventory: { mcpServers: 2, prompts: 1, skills: 3 },
          providers: [
            {
              externalId: 'claude:test-anthropic',
              app: 'claude',
              name: 'Fixture Anthropic',
              providerKind: 'anthropic',
              config: { baseUrl: 'https://anthropic.example.test', model: 'claude-test' },
              credential: { kind: 'api-key', value: 'test-secret-value', label: 'Fixture Anthropic' },
              metadata: { baseUrl: 'https://anthropic.example.test', model: 'claude-test', health: 'unknown' },
            },
            {
              externalId: 'codex:test-openai',
              app: 'codex',
              name: 'Fixture OpenAI',
              providerKind: 'openai-compatible',
              config: { baseUrl: 'https://openai.example.test', model: 'gpt-test', apiMode: 'responses' },
              credential: { kind: 'api-key', value: 'test-secret-value', label: 'Fixture OpenAI' },
              metadata: { baseUrl: 'https://openai.example.test', model: 'gpt-test', apiFormat: 'openai_responses' },
            },
          ],
        }
      },
    })

Run targeted checks:

    pnpm --filter @cradle/plugin-sdk typecheck
    pnpm --filter @cradle/server test
    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/web exec tsc --noEmit
    pnpm test -- external-provider

Then run broader checks before marking implementation complete:

    pnpm typecheck
    pnpm test

If frontend UI changes are substantial, start the dev server and inspect the Provider settings page:

    pnpm dev:fullstack

Expected manual observation: Provider settings shows fixture mirrored providers with a fixed external source section. Editing source-owned fields is disabled or blocked with a clear message. Refreshing the source updates metadata without exposing plaintext credentials.

## Validation and Acceptance

Server acceptance:

1. A fixture plugin can register an external provider source through `ctx.externalProviderSources.register`.
2. `GET /external-provider-sources` returns the fixture source with label, status, capabilities, inventory counts and last sync fields. It does not return secrets.
3. `POST /external-provider-sources/<fixture-source-key>/refresh` calls the fixture `readSnapshot`, writes source metadata, records, mirrored profiles and encrypted credentials in one consistent operation.
4. `GET /external-provider-sources/records` returns the two fixture records with `active` status.
5. `GET /profiles/<mirrored-profile-id>/external-source` returns source label, external id, app, metadata and warnings.
6. Calling the ordinary profile update path on a mirrored profile fails with a clear domain error such as `PROFILE_MANAGED_BY_EXTERNAL_SOURCE`. Projection refresh can still update the same profile.
7. If the fixture source later omits one previous record and refresh succeeds, the omitted record becomes `missing` and its mirrored profile becomes disabled. Existing sessions or agents should not be deleted.
8. If fixture `readSnapshot` throws, source status becomes `error`, previous records remain present, and existing profiles are not deleted or disabled.

Secret acceptance:

1. The plaintext fixture secret never appears in route JSON, logs or profile `configJson`.
2. `agent_credentials.encrypted_secret` changes when the source changes the credential value.
3. Stable credential refs remain stable across refreshes when the same source/external id is returned.

Frontend acceptance:

1. Provider list shows external providers using Cradle's fixed row UI and a fixed external badge.
2. Provider detail shows a fixed Source section when `GET /profiles/:id/external-source` returns metadata.
3. Optional fields are omitted when absent; no empty placeholder rows appear.
4. Source-owned fields are disabled or blocked, with a message telling the user the provider is managed by the external source.
5. The UI uses existing design system conventions and static Tailwind classes.

Type and test acceptance:

1. `pnpm --filter @cradle/plugin-sdk typecheck` passes.
2. `pnpm --filter @cradle/server test` passes, including new external provider source tests.
3. `pnpm --filter @cradle/web exec tsc --noEmit` passes.
4. `pnpm typecheck` and `pnpm test` pass before final completion.

## Idempotence and Recovery

All source refresh operations must be idempotent. Running refresh repeatedly with the same snapshot should not create duplicate profiles, credentials, records or links. Stable ids must be derived from source key and external id, not generated randomly per refresh.

DB migrations are additive. If migration generation fails, do not edit generated SQL blindly. Inspect the schema definitions, rerun the Drizzle generation command, and verify that the resulting SQL only creates new external source tables and indexes. Do not modify CC Switch DB or any external namespace.

If a plugin throws during `readSnapshot`, catch the error at the host boundary, store a redacted error message in `external_provider_sources.lastSyncError`, set status to `error`, and keep previous projection rows intact. A source read failure is not evidence that all external providers were removed.

If a projection fails after writing some rows, use a database transaction so the entire refresh rolls back. The source status may be updated to `error` in a separate small transaction after rollback. Never leave a profile pointing at a missing credential ref because of a partial refresh.

If the fixed UI fails to load external metadata, Provider settings should still render normal profiles. Show a non-blocking warning for external metadata failure; do not block all provider management.

If future work adds `importAsNative`, it must be explicit and reversible at the Cradle level. It should create a normal Cradle-owned profile copy and detach it from the external link. This plan does not implement import as native in the first version.

## Artifacts and Notes

Current source evidence:

    packages/plugin-sdk/src/server.ts
      ServerPluginContext exposes app, registerMcpServer, registerSkill, storage, logger, sharedConfig, manifest, hooks and events.

    apps/server/src/plugins/storage.ts
      createPluginStorage uses an in-memory Map and is not suitable for source truth.

    apps/web/src/lib/plugin-host.ts
      WebPluginContext only registers panels and commands; Provider settings is not plugin-controlled.

    packages/db/src/schema/identity.ts
      agentProfiles and agentCredentials are the Cradle-owned runtime profile and secret tables.

The intended final dependency direction is:

    plugin package
      -> @cradle/plugin-sdk/server types
      -> returns ExternalProviderSourceSnapshot

    apps/server/src/plugins
      -> owns registration of plugin-provided source readers

    apps/server/src/modules/external-provider-sources
      -> owns validation, refresh, projection, persistence, route output

    apps/server/src/modules/profiles
      -> blocks ordinary edits to mirrored profiles

    apps/web/src/features/agent-management
      -> renders fixed external source UI from host route data

The first real adapter after fixture validation should be CC Switch. It should read CC Switch files, return the fixed snapshot shape, and never write to `~/.cc-switch`.

## Interfaces and Dependencies

`packages/plugin-sdk/src/server.ts` must export these public interfaces:

    export interface ServerPluginContext {
      app: unknown
      registerMcpServer(config: McpServerConfig): void
      registerSkill(skill: SkillDefinition): void
      externalProviderSources: ExternalProviderSourceRegistry
      storage: PluginStorage
      logger: Logger
      sharedConfig: ReadonlyMap<string, string>
      manifest: PluginManifest
      hooks: ServerPluginHooks
      events: PluginEventBus
    }

    export interface ExternalProviderSourceRegistry {
      register(source: ExternalProviderSource): Disposable
    }

    export interface ExternalProviderSource {
      id: string
      label: string
      description?: string
      capabilities?: ExternalProviderSourceCapabilities
      readSnapshot(ctx: ExternalProviderSourceReadContext): Promise<ExternalProviderSourceSnapshot>
    }

    export interface ExternalProviderSourceSnapshot {
      source: ExternalProviderSourceSnapshotInfo
      providers: ExternalProviderRecord[]
      inventory?: ExternalProviderInventory
      warnings?: ExternalProviderWarning[]
    }

`apps/server/src/plugins/external-provider-source-registry.ts` must provide:

    export interface RegisteredExternalProviderSource {
      key: string
      owner: string
      source: ExternalProviderSource
      registeredAt: number
    }

    export function registerExternalProviderSource(owner: string, source: ExternalProviderSource): Disposable
    export function listExternalProviderSources(): RegisteredExternalProviderSource[]
    export function getExternalProviderSource(sourceKey: string): RegisteredExternalProviderSource | null
    export function resetExternalProviderSourceRegistry(): void

`apps/server/src/modules/external-provider-sources/service.ts` must provide:

    export interface ExternalProviderRefreshResult {
      sourceKey: string
      status: 'ok' | 'warning' | 'error'
      recordsSeen: number
      recordsProjected: number
      recordsMissing: number
      message?: string
    }

    export function listExternalProviderSources(): ExternalProviderSourceView[]
    export async function refreshExternalProviderSource(sourceKey: string): Promise<ExternalProviderRefreshResult>
    export async function refreshAllExternalProviderSources(): Promise<ExternalProviderRefreshResult[]>
    export function getExternalProfileLink(profileId: string): ExternalProfileLinkView | null
    export function isExternalProfile(profileId: string): boolean

`apps/server/src/modules/profiles/service.ts` must keep public profile APIs for native profiles and add projection-only helpers:

    export function upsertProfile(input: UpsertProfileInput): AgentProfile
    export function upsertMirroredProfile(input: UpsertProfileInput): AgentProfile

Only `apps/server/src/modules/external-provider-sources/service.ts` should call `upsertMirroredProfile`.

No new UI contribution API should be added for this feature. `packages/plugin-sdk/src/web.ts` should remain unchanged unless documentation comments need to clarify that Provider settings surface is host-owned. Complex plugin-specific inspection can continue to use existing `registerPanel`.

## Revision Notes

- 2026-05-21 09:37Z: Initial plan created after design discussion. The plan intentionally rejects plugin-controlled Provider UI and instead defines a fixed snapshot contract plus host-owned projection and fixed Cradle UI.
- 2026-05-21 10:52Z: Implementation completed for SDK contract, server host registry, DB projection schema, routes, profile read-only guard, fixed Provider UI, fixture tests, and docs. Validation notes record the unrelated web typecheck and full server test blockers.
- 2026-05-21 10:59Z: Validation blockers resolved with focused test-only fixes. Repo-wide `pnpm typecheck` and `pnpm test` now pass.
- 2026-05-21 11:41Z: Added `plugins/cc-switch` as the first real external provider source adapter. It keeps Plugin API simple by returning standard snapshot data and leaves projection/UI ownership in Cradle host.
- 2026-05-21 11:45Z: Added host integration coverage for the CC Switch plugin using a temporary fake CC Switch database and environment path overrides.
