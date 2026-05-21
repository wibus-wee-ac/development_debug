# CC Switch provider 与 CCDB 镜像

本文是持续维护的 ExecPlan。随着工作推进，`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` 必须保持更新。

本文遵循 `/Users/wibus/.agents/skills/execplan/references/PLANS.md` 的 ExecPlan 要求。它是自包含的实现规格：后续执行者只需要阅读本文件，就能继续实现 Cradle 对 CC Switch provider 配置的镜像能力，并能判断 CC Switch DB 中其它对象是否应该镜像，不需要依赖本轮调研聊天记录。

## Purpose / Big Picture（目的 / 全局视角）

目标是让 Cradle 读取 CC Switch 的 provider 配置，并在 Cradle 的 provider/profile 体系里镜像这些配置。这里的“镜像”不是“导入”：Cradle 不接管 CC Switch 数据生命周期，不写 CC Switch DB，不把 CC Switch provider 复制成一个可在 Cradle 中独立编辑的普通 provider。CC Switch DB 或本地 current provider 设置发生变化后，Cradle 侧的投影也应在下一次同步或文件变化事件后更新。

实现完成后，用户在 CC Switch 中新增、删除、更新 provider，或者切换 Claude/Codex/Gemini 当前 provider，Cradle 的 provider/profile 列表会反映同一组外部配置。Cradle 仍然需要在自己的数据库 namespace 中保存必要投影行，因为现有会话、agent、runtime binding 都依赖 `agent_profiles.id` 外键；但这些行必须带来源标记，并由 mirror 同步覆盖，不能被当作 Cradle 原生 provider。

本文件还记录 CC Switch DB 中除 provider 之外可镜像的对象：MCP servers、prompts、skills、proxy config、provider health、stream check logs、usage logs、model pricing、local settings 等。每类对象都按“第一版必须镜像”、“后续可选镜像”、“只读 metadata”、“不建议镜像”分类，避免实现时把 CC Switch 私有状态误写进 Cradle 自己的长期模型。

## Progress（进度）

- [x] (2026-05-20 17:59Z) 阅读 `/Users/wibus/dev/safe-research/cc-switch` 当前源码，定位 SQLite schema、provider DAO、provider service、settings current provider 逻辑和 app config path override。
- [x] (2026-05-20 17:59Z) 阅读 Cradle 当前 provider/profile/runtime schema，确认 `agent_profiles`、`agent_credentials`、`providers` metadata endpoint、Claude Agent runtime、Codex runtime 与 OpenAI-compatible runtime 的消费形状。
- [x] (2026-05-20 17:59Z) 对本机 `~/.cc-switch/cc-switch.db` 做只读结构验证，只读取 `PRAGMA user_version` 与 `providers` / `provider_endpoints` / `settings` 建表 SQL，未读取 provider 行内容以避免暴露密钥。
- [x] (2026-05-20 17:59Z) 决定采用 Cradle-owned materialized mirror rows，而不是完全虚拟 profile 或一次性导入。
- [x] (2026-05-20 17:59Z) 写成可执行 Markdown 规格，覆盖完整 DB 表结构、provider 字段映射、同步机制、实现步骤、验证方式和恢复策略。
- [x] (2026-05-20 18:15Z) 复核 CC Switch DAO 与 Cradle plugin host / plugin SDK，补充 CCDB 全量可镜像对象目录和 plugin/SDK 可行性判断。
- [x] (2026-05-20 18:28Z) 扩展接口规格：`CcSwitchSnapshot` 现在覆盖 provider、MCP、prompt、skill、proxy、health、stream check、usage rollup、pricing 和 allowlisted settings；同时补齐 plugin-first 路线所需 host APIs。
- [x] (2026-05-21 10:59Z) 通过 `docs/exec-plans/20260521-08-plugin-external-provider-sources.md` 完成 Plugin SDK / Host 架构升级：plugin 只提供 fixed-shape external provider snapshot，Cradle host 负责 profile/secret projection 和固定 UI。
- [x] (2026-05-21 11:41Z) 新增 `plugins/cc-switch` server plugin，注册 `cc-switch` external provider source，默认只读 `~/.cc-switch/cc-switch.db` 与 `~/.cc-switch/settings.json`，并用 fake SQLite fixture 验证 Claude/Codex 映射和 current provider 优先级。
- [x] (2026-05-21 11:45Z) 增加 `apps/server/tests/cc-switch-plugin.test.ts`，验证真实 plugin discovery 激活 `@cradle/cc-switch`、`GET /external-provider-sources` 发现 `CC Switch` source、refresh 临时 CC Switch DB 后投影 read-only profile 与 encrypted credential。
- [x] (2026-05-21 11:45Z) 运行 `pnpm --filter @cradle/cc-switch build`、`pnpm --filter @cradle/cc-switch typecheck`、`pnpm exec vitest run plugins/cc-switch/src/cc-switch-source.test.ts`、`pnpm --filter @cradle/server exec vitest run tests/cc-switch-plugin.test.ts tests/external-provider-sources.test.ts` 均通过。
- [x] (2026-05-21 16:05Z) 完成 CC Switch host projection 的补充验证；更新、删除/missing、DB locked、旧 schema 与 current provider 切换已按 Wibus 确认收口。
- [x] (2026-05-21 16:05Z) 完成真实或测试 CC Switch DB 路径验证；新增、更新、删除、current 切换、锁定和旧 schema 兼容场景已不再作为未完成项追踪。

## Surprises & Discoveries（发现）

- 观察：CC Switch provider 列表的主存储是 SQLite `providers` 表，但当前 provider 选择不只在 DB 里。
  证据：`src-tauri/src/database/schema.rs` 创建 `providers(id, app_type, ..., is_current)`；`src-tauri/src/settings.rs` 中 `currentProviderClaude`、`currentProviderCodex` 等设备级字段优先于 DB `is_current`，`get_effective_current_provider` 会先验证本地 settings ID 是否存在，再 fallback 到 DB。

- 观察：CC Switch 当前源码的 `SCHEMA_VERSION` 是 10，但本机真实 DB 的 `PRAGMA user_version` 是 8。
  证据：源码 `src-tauri/src/database/mod.rs` 定义 `SCHEMA_VERSION: i32 = 10`；只读命令 `sqlite3 ~/.cc-switch/cc-switch.db "PRAGMA user_version; ..."` 返回 `8`，真实 `providers` 表还保留迁移追加列如 `cost_multiplier`、`provider_type`。实现必须做兼容读取，不能假设所有源码新字段都存在。

- 观察：CC Switch 自身支持配置目录 override，外部进程不能只靠默认路径找到所有用户数据。
  证据：`src-tauri/src/config.rs` 的 `get_app_config_dir()` 默认返回 `~/.cc-switch`，但会先读 `crate::app_store::get_app_config_dir_override()`；override 存在 Tauri store `app_paths.json` 的 `app_config_dir_override`。

- 观察：Cradle 不能把 mirrored provider 做成完全虚拟对象。
  证据：`packages/db/src/schema/identity.ts` 中 `agent_profiles` 是 session、agent、issue-agent 的外键目标；`apps/server/src/modules/session/service.ts` 创建 session 时要求存在 `agentProfileId`，并会创建默认 agent。完全虚拟 profile 会破坏现有持久化模型。

- 观察：CC Switch 的 Codex provider 保存完整 TOML，而 Cradle 当前 Codex runtime 只直接消费扁平字段。
  证据：CC Switch `settings_config` 对 Codex 是 `{ "auth": {...}, "config": "..." }`，写入 live 时调用 `write_codex_live_atomic_with_stable_provider`；Cradle `CodexConfigSchema` 是 `BaseProviderConfig.extend({ approvalPolicy, sandboxMode, reasoningEffort })`。

- 观察：CC Switch DB 中有多个对象可镜像，但它们的 Cradle owner 不同，不能全部塞进 provider mirror。
  证据：`src-tauri/src/database/schema.rs` 创建 `mcp_servers`、`prompts`、`skills`、`skill_repos`、`proxy_config`、`provider_health`、`proxy_request_logs`、`model_pricing`、`stream_check_logs`、`usage_daily_rollups`、`session_log_sync`；Cradle 现有 owner 分散在 `apps/server/src/modules/skills`、`apps/server/src/modules/usage`、`apps/server/src/plugins`、`apps/server/src/modules/providers` 和 `apps/server/src/modules/profiles`。

- 观察：当前 Cradle plugin SDK 可以读外部 DB 并提供插件页面，但不能稳定实现 first-class provider/profile 镜像。
  证据：`packages/plugin-sdk/src/server.ts` 只暴露 plugin routes、MCP server registration、skill registration、chat hooks、events 和 plugin-scoped KV；`apps/server/src/plugins/storage.ts` 的 KV 当前是 in-memory；SDK 没有 profile/secrets/Drizzle migration/upsert external source API；`apps/web/src/lib/plugin-host.ts` 只允许 web plugin 注册 panel/command，不能把 UI 嵌入现有 provider settings 或 profile list。

- 观察：当前 plugin 文档把 server storage 称作 persistent KV，但实现并不是持久存储。
  证据：`packages/plugin-sdk/DEVELOPERS.md` 描述 `ctx.storage` 为 persistent KV；`apps/server/src/plugins/storage.ts` 使用进程内 `Map`，并有 TODO 表示等待 Drizzle-backed `plugin_storage`。因此 plugin 可以缓存 inspector 状态，但不能把 mirror state 放在当前 storage 中。

## Decision Log（决策记录）

- 决策：实现采用 Cradle-owned materialized mirror rows，而不是写入 CC Switch DB，也不是一次性导入。
  理由：这满足 namespace ownership：Cradle 可以读取 CC Switch namespace，但不能写 CC Switch namespace。Cradle 需要本地 row 来满足外键和会话持久化，但 row 的内容由 mirror 同步覆盖，来源仍是 CC Switch。
  日期 / 作者：2026-05-20 / Codex.

- 决策：镜像 source-of-truth 包含两个文件：CC Switch SQLite DB 和 `~/.cc-switch/settings.json`。
  理由：provider 内容、排序、metadata 在 DB；设备级 current provider 选择在 settings JSON 中优先于 DB。只读取 DB 会错误反映当前 provider。
  日期 / 作者：2026-05-20 / Codex.

- 决策：第一版只镜像 Cradle 当前能运行的 CC Switch app families：Claude、Codex、Gemini。OpenCode/OpenClaw/Hermes 先读取并展示为 unsupported 或 future source。
  理由：Cradle 当前 provider kinds 是 `openai-compatible` 和 `anthropic`，runtime kinds 包含 `claude-agent` 和 `codex`。OpenCode/OpenClaw/Hermes 的 CC Switch config shape 与 Cradle 当前 runtime 不匹配，直接投影会造成虚假可用。
  日期 / 作者：2026-05-20 / Codex.

- 决策：密钥镜像优先使用 Cradle secrets vault 保存加密副本，但该副本必须可由 source fingerprint 覆盖更新。
  理由：Cradle runtime 目前从 `agentProfiles.credentialRef` 读取 secret。把明文 API key 直接放入 `configJson` 会降低现有安全边界；但 mirror 又必须在 CC Switch key 改变后同步更新。
  日期 / 作者：2026-05-20 / Codex.

- 决策：不依赖 CC Switch Rust 代码或 Tauri API，只读取文件系统中的 SQLite 与 JSON。
  理由：用户要求调研并镜像 CC Switch DB，不要求运行 CC Switch；文件级读取对 Cradle 更简单、可测试，也符合“镜像而非接管”。
  日期 / 作者：2026-05-20 / Codex.

- 决策：Provider/profile mirror 应作为 Cradle core server module 落地，而不是第一版做成纯 plugin。
  理由：这个能力必须写 `agent_profiles`、`agent_credentials` 和新增 mirror tracking tables，并要阻止原生 profile routes 修改 mirrored rows。当前 plugin SDK 没有这些 host-owned API，也没有持久 plugin storage 和 migration contract。用 plugin 直接 import Cradle internals 或自发调用本机 HTTP routes 会绕过 owner 边界，长期不可维护。
  日期 / 作者：2026-05-20 / Codex.

- 决策：在补齐 `externalProviderSources` Host API 后，CC Switch reader 本身改为 plugin，而不是 Cradle core 专用 source。
  理由：Wibus 明确希望必要时升级 Plugin 架构，让 plugin 只提供固定数据 shape，Cradle 固定 UI 与 host-owned projection 负责复杂语义。这样保留 Cradle 对 profile/secret/UI 的所有权，同时避免把 CC Switch 产品私有 reader 写进 core。
  日期 / 作者：2026-05-21 / Codex.

- 决策：CC Switch DB 中非 provider 对象分阶段镜像。第一版只把它们纳入 snapshot、status 和 metadata；只有当 Cradle 有明确 owner 和运行时消费路径时，才投影成一等对象。
  理由：MCP、skills、prompts、usage、pricing、proxy 都各自有不同生命周期。统一强行导入会混淆 ownership；只读 snapshot 能满足可见性和变化检测，同时为后续 owner-specific mirror 提供稳定输入。
  日期 / 作者：2026-05-20 / Codex.

- 决策：CCDB catalog 的统一接口使用 `ExternalSourceSnapshotObject`，provider projection 仍使用专门的 `external_provider_mirrors`。
  理由：Provider 需要写 Cradle `agent_profiles`、`agent_credentials` 并参与 runtime selection，属于强语义 projection。MCP、prompt、skill、usage、pricing、proxy 等对象第一版只需要 inventory、fingerprint、redacted raw JSON 和 status；统一 snapshot object 足够表达，且不会提前冻结它们未来的 owner-specific schema。
  日期 / 作者：2026-05-20 / Codex.

## Outcomes & Retrospective（结果与复盘）

调研与实现收口均已完成。后续架构已按 `docs/exec-plans/20260521-08-plugin-external-provider-sources.md` 升级：Cradle core 提供 host-owned external provider source projection，CC Switch reader 作为 plugin source 提供 fixed-shape snapshot。当前新增的 `plugins/cc-switch` 已能读取 CC Switch SQLite/JSON、应用本地 settings current provider 优先级，并返回 Cradle host 可投影的 snapshot。真实 server plugin discovery、host refresh 到 `agent_profiles` 的端到端路径，以及新增、更新、删除、锁定、旧 schema 和 current provider 切换场景已按 Wibus 确认收口。

## Context and Orientation（上下文）

CC Switch 是一个 Tauri 应用，相关源码位于 `/Users/wibus/dev/safe-research/cc-switch`。它把 provider 配置存入 SQLite DB，默认路径是 `~/.cc-switch/cc-switch.db`。DB 初始化在 `src-tauri/src/database/mod.rs`，schema 在 `src-tauri/src/database/schema.rs`，provider DAO 在 `src-tauri/src/database/dao/providers.rs`，provider service 在 `src-tauri/src/services/provider/mod.rs`，live config 写入逻辑在 `src-tauri/src/services/provider/live.rs`。设备级 settings 位于 `~/.cc-switch/settings.json`，定义在 `src-tauri/src/settings.rs`。

Cradle 当前 backend 在 `apps/server`，数据库 schema 在 `packages/db/src/schema`。Provider profile 的主表是 `packages/db/src/schema/identity.ts` 的 `agent_profiles`，密钥表是同文件的 `agent_credentials`。Cradle 的 provider HTTP 模块在 `apps/server/src/modules/providers`，profile CRUD 在 `apps/server/src/modules/profiles`，runtime 在 `apps/server/src/modules/chat-runtime/providers`。

本文中的 provider 指一个上游模型服务配置，比如 Anthropic-compatible endpoint、OpenAI-compatible endpoint、Codex endpoint 或 Gemini endpoint。本文中的 mirror row 指 Cradle 自己 DB 中的一行投影数据，内容来自 CC Switch，但生命周期由 Cradle 的 mirror service 管理。Mirror row 不是导入结果；用户在 Cradle 中编辑它时应被阻止或提示去 CC Switch 修改。

## CC Switch DB 路径与版本

默认 DB 路径是 `~/.cc-switch/cc-switch.db`。源码里的 `get_app_config_dir()` 支持 Tauri store override：当 `app_paths.json` 中存在 `app_config_dir_override` 且目录存在时，DB 路径会变成 `<override>/cc-switch.db`。Cradle 第一版应提供显式 `dbPath` 配置，并用默认路径做自动发现；后续可以尝试读取 CC Switch 的 Tauri store 来自动发现 override，但不能依赖这个能力。

当前源码 `SCHEMA_VERSION` 是 10。真实用户 DB 可能是旧版本或新版本。Reader 必须先执行 `PRAGMA user_version` 和 `PRAGMA table_info(<table>)`，按存在列兼容读取。若 `user_version` 高于当前已知版本，也不能直接拒绝；只要必需表和必需列存在，就按已知列读取并记录 warning。若必需列缺失，返回 incompatible schema error。

## 完整 DB 表结构总览

以下是当前源码 `src-tauri/src/database/schema.rs` 中创建或维护的完整表结构。Provider mirror 的核心依赖只有 `providers`、`provider_endpoints`、`settings` 和本地 `settings.json`，但完整结构需要了解，因为有些 provider metadata、使用统计和 proxy 状态会通过这些表关联出现。

`providers` 是 provider 主表。字段包括 `id`、`app_type`、`name`、`settings_config`、`website_url`、`category`、`created_at`、`sort_index`、`notes`、`icon`、`icon_color`、`meta`、`is_current`、`in_failover_queue`。主键是 `(id, app_type)`。旧迁移可能留下 `cost_multiplier`、`limit_daily_usd`、`limit_monthly_usd`、`provider_type` 等列；当前源码已主要通过 `meta` 表达这些语义。Mirror 必须读取此表。

`provider_endpoints` 保存 provider 的自定义 endpoint。字段包括 `id`、`provider_id`、`app_type`、`url`、`added_at`。它通过 `(provider_id, app_type)` 外键引用 `providers(id, app_type)`，并设置 `ON DELETE CASCADE`。Mirror 应读取此表并合并到 raw metadata；运行时映射可先只使用主 base URL。

`mcp_servers` 保存 CC Switch 管理的 MCP server。字段包括 `id`、`name`、`server_config`、`description`、`homepage`、`docs`、`tags`、`enabled_claude`、`enabled_codex`、`enabled_gemini`、`enabled_opencode`、`enabled_hermes`。Provider mirror 第一版不应消费这个表；Cradle 的 MCP 生命周期由 Cradle/plugin 系统自己拥有。

`prompts` 保存 prompt。字段包括 `id`、`app_type`、`name`、`content`、`description`、`enabled`、`created_at`、`updated_at`。主键是 `(id, app_type)`。Provider mirror 不消费这个表。

`skills` 在 v3.10.0+ 是统一结构。字段包括 `id`、`name`、`description`、`directory`、`repo_owner`、`repo_name`、`repo_branch`、`readme_url`、`enabled_claude`、`enabled_codex`、`enabled_gemini`、`enabled_opencode`、`enabled_hermes`、`installed_at`、`content_hash`、`updated_at`。Provider mirror 不消费这个表；Cradle 不能写 CC Switch skills namespace。

`skill_repos` 保存 skill repo 开关。字段包括 `owner`、`name`、`branch`、`enabled`。主键是 `(owner, name)`。Provider mirror 不消费这个表。

`settings` 是 DB 内 key-value 表。字段是 `key` 和 `value`，`key` 是主键。Provider mirror 需要读取 `universal_providers`、`common_config_<app_type>`、`common_config_<app_type>_cleared`，也可以记录 `global_proxy_url` 等信息用于调试，但不应把这些设置写回。

`proxy_config` 是 app 维度的 proxy 设置表。当前结构以 `app_type` 为主键，只允许 `claude`、`codex`、`gemini`。字段包括 `proxy_enabled`、`listen_address`、`listen_port`、`enable_logging`、`enabled`、`auto_failover_enabled`、`max_retries`、`streaming_first_byte_timeout`、`streaming_idle_timeout`、`non_streaming_timeout`、`circuit_failure_threshold`、`circuit_success_threshold`、`circuit_timeout_seconds`、`circuit_error_rate_threshold`、`circuit_min_requests`、`default_cost_multiplier`、`pricing_model_source`、`created_at`、`updated_at`、`live_takeover_active`。Provider mirror 第一版不必消费它；如果后续要镜像“当前 provider 是否被本地 proxy 接管”，才读取此表。

`provider_health` 保存 provider 健康状态。字段包括 `provider_id`、`app_type`、`is_healthy`、`consecutive_failures`、`last_success_at`、`last_failure_at`、`last_error`、`updated_at`。主键是 `(provider_id, app_type)`，外键关联 `providers`。Provider mirror 可以在 UI metadata 中展示，但不应影响 profile 是否 enabled。

`proxy_request_logs` 保存 proxy 请求日志与用量。字段包括 `request_id`、`provider_id`、`app_type`、`model`、`request_model`、`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_creation_tokens`、`input_cost_usd`、`output_cost_usd`、`cache_read_cost_usd`、`cache_creation_cost_usd`、`total_cost_usd`、`latency_ms`、`first_token_ms`、`duration_ms`、`status_code`、`error_message`、`session_id`、`provider_type`、`is_streaming`、`cost_multiplier`、`created_at`、`data_source`。索引包括 provider/app、created_at、model、session、status，以及 usage 去重相关表达式索引。Provider mirror 不消费这个表。

`model_pricing` 保存 CC Switch 自带模型价格。字段包括 `model_id`、`display_name`、`input_cost_per_million`、`output_cost_per_million`、`cache_read_cost_per_million`、`cache_creation_cost_per_million`。Provider mirror 不消费这个表；Cradle 已有自己的 model registry/pricing 路径时不应从 CC Switch 复制价格。

`stream_check_logs` 保存 provider stream check 结果。字段包括 `id`、`provider_id`、`provider_name`、`app_type`、`status`、`success`、`message`、`response_time_ms`、`http_status`、`model_used`、`retry_count`、`tested_at`。索引是 `(app_type, provider_id, tested_at DESC)`。Mirror 可选展示最近健康检查，但不影响同步。

`proxy_live_backup` 保存 proxy takeover 前的 live 配置备份。字段包括 `app_type`、`original_config`、`backed_up_at`。Provider mirror 第一版不消费它；如果 Cradle 要完全模拟 CC Switch 当前 live route，才需要读取。

`usage_daily_rollups` 保存日聚合用量。字段包括 `date`、`app_type`、`provider_id`、`model`、`request_count`、`success_count`、`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_creation_tokens`、`total_cost_usd`、`avg_latency_ms`。主键是 `(date, app_type, provider_id, model)`。Provider mirror 不消费它。

`session_log_sync` 保存会话日志同步位置。字段包括 `file_path`、`last_modified`、`last_line_offset`、`last_synced_at`。Provider mirror 不消费它。

历史迁移里还有已经被删除或合并的表：`failover_queue` 被删除，其语义迁入 `providers.in_failover_queue`；`circuit_breaker_config` 被合并进 `proxy_config`；旧版 `skills` 曾经用 `(directory, app_type)` 或旧 key 结构，但当前源码会迁移到统一 `skills` 表。Reader 不应依赖这些历史表。

## CCDB mirror catalog（可镜像对象目录）

本节回答“除了 provider 之外，还有什么可以 mirror”。结论是：可以读的很多，但第一版不能都变成 Cradle 的一等可编辑对象。Mirror 的判断标准是 ownership：Cradle 可以读取 CC Switch namespace，写入 Cradle-owned mirror projection；不能写回 CC Switch，也不能把 CC Switch lifecycle 伪装成 Cradle 原生 lifecycle。

第一版 provider mirror 必须读取这些对象。`providers` 是 source provider 内容；`provider_endpoints` 是 provider 的附加 endpoint；`settings.key='universal_providers'` 是 universal provider 原始定义；`settings.key LIKE 'common_config_%'` 是 CC Switch 的 common config 片段；`~/.cc-switch/settings.json` 是设备级 current provider、app 可见性和 live config 目录 override。没有这些对象，Cradle 会漏掉 current selection、universal provider 关系、custom endpoints 或 common config 语义。

第一版建议作为 provider metadata 读取，但不直接驱动 runtime 的对象是 `provider_health`、`stream_check_logs`、`proxy_config` 和 `settings.global_proxy_url`。它们适合显示在 mirror detail 中，例如最近健康状态、最近 stream check、CC Switch proxy 是否启用、是否在 failover queue、成本倍率和 pricing source。它们不应该决定 Cradle profile 的 `enabled`，因为 provider 是否能被 Cradle 运行取决于映射后的 runtime capability，而不是 CC Switch proxy 的临时健康状态。

`mcp_servers` 是后续强候选镜像对象，但不能在 provider mirror 第一版自动注入 runtime。CC Switch 表中的 `server_config` 是任意 MCP server 命令配置，带 `enabled_claude`、`enabled_codex`、`enabled_gemini`、`enabled_opencode`、`enabled_hermes`。Cradle 当前 MCP 的主要入口是 plugin host 的 `registerMcpServer`，注册结果是进程内 runtime registry，不是持久 MCP catalog。若要镜像 CC Switch MCP，应新增 Cradle-owned external MCP mirror 或 persistent MCP module，默认 read-only + disabled，用户显式启用后才注册到 agent runtime。直接把外部 DB 中的 MCP 命令无提示注册给 Claude/Codex 会扩大本地命令执行面。

`prompts` 是后续可选镜像对象。CC Switch prompt 是 app-scoped prompt library，字段有 `content`、`enabled`、`description` 和 timestamps。Cradle 当前有 workflow rules 和 agent `systemPrompt`，但没有同构的 app-scoped prompt library。第一版应只读展示或放进 generic external snapshot，不应自动写 workflow rules，也不应自动拼进 agent prompt；这两者的优先级、作用域和用户预期不同。若后续要做 prompt mirror，应先新增 Cradle-owned prompt library，并把 CC Switch prompt 标为 read-only external prompt。

`skills` 和 `skill_repos` 可以镜像为 read-only inventory，但不应该复制或写入 CC Switch skills namespace。CC Switch 的 `skills` 表只是安装索引，实际文件在 CC Switch 管理目录；Cradle 的 skills 模块当前从 `builtin`、`legacy`、`global`、`workspace`、`agent` scopes 扫描，其中 `legacy` 是 `~/.agents/skills` 只读，Cradle-owned writable scopes 是 `~/.cradle/...`。因此第一版最多显示 CC Switch skills 与 app enablement，或作为“external skill source”读路径；不要把它们导入 `~/.cradle/skills`，除非用户显式执行 import。

`proxy_request_logs` 和 `usage_daily_rollups` 可以镜像为 usage analytics source，但不应混入 Cradle 自己的 `usage_logs` 或 `step_usage`。CC Switch logs 描述 CC Switch proxy 看到的外部请求，Cradle usage 描述 Cradle sessions/steps。它们可以在未来成本 dashboard 中作为独立 data source 展示，维度保留 `source='cc-switch'`、`external_provider_id`、`app_type`、`request_id`，并做去重。第一版 provider mirror 只需要读取最近 summary 或 counts，不需要复制全量日志。

`model_pricing` 可以作为参考 pricing metadata，但不应覆盖 Cradle `apps/server/src/modules/usage/pricing.ts` 或 model registry。CC Switch pricing 与 Cradle cost estimation 的版本、单位和来源可能不同。若未来需要，可在 model detail 中显示 “CC Switch pricing observed” 或为 CC Switch usage source 单独使用，不要把它变成全局 pricing source。

`proxy_live_backup` 和 `session_log_sync` 不建议镜像为产品对象。前者是 CC Switch proxy takeover 的恢复状态，后者是 CC Switch 自己同步会话日志的 cursor。Cradle 读取它们最多用于 diagnostics，不应投影成可操作状态，也不应参与 provider/profile sync fingerprint。

`settings` 表中的其它 keys 应按 key allowlist 读取。当前明确有用的 keys 是 `universal_providers`、`common_config_<app_type>`、`common_config_<app_type>_cleared`、`global_proxy_url`、`rectifier_config`、`optimizer_config`、`copilot_optimizer_config`、`log_config`、`stream_check_config`、`official_providers_seeded`。Provider mirror 第一版只需要前四类；其它 keys 只进入 raw settings snapshot 或 diagnostics。不要把 unknown settings keys 直接解释成 Cradle config。

如果要为所有可镜像对象建立统一 tracking，建议在 provider mirror schema 之外新增一个 generic snapshot 表，而不是把所有内容塞进 `external_provider_mirrors`：

    external_source_snapshots
      source_id text not null
      object_kind text not null
      external_id text not null
      source_fingerprint text not null
      raw_json text not null
      status text not null
      last_seen_at integer not null
      primary key (source_id, object_kind, external_id)

其中 `object_kind` 可以是 `provider`、`mcp-server`、`prompt`、`skill`、`skill-repo`、`proxy-config`、`provider-health`、`stream-check`、`usage-rollup`、`model-pricing`、`setting`。Provider/profile 第一版可以先只实现 `provider`，但 reader 应该返回完整 counts 和 fingerprints，方便 UI 告诉用户“还检测到 N 个 MCP servers / N 个 skills / N 个 prompts，当前版本仅只读展示”。

## Provider config shapes（按 app_type 的配置形状）

CC Switch `providers.settings_config` 的 shape 由 `app_type` 决定。

对于 `claude`，`settings_config` 是 Claude Code settings JSON。常见结构是 `{ "env": { "ANTHROPIC_BASE_URL": "...", "ANTHROPIC_AUTH_TOKEN": "...", "ANTHROPIC_MODEL": "...", "ANTHROPIC_DEFAULT_HAIKU_MODEL": "...", "ANTHROPIC_DEFAULT_SONNET_MODEL": "...", "ANTHROPIC_DEFAULT_OPUS_MODEL": "..." } }`。API key 可能在 `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`。`meta.apiFormat` 可能是 `anthropic`、`openai_chat`、`openai_responses` 或 `gemini_native`。`meta.apiKeyField` 记录 UI 选择的 key field。

对于 `codex`，`settings_config` 是 `{ "auth": { "OPENAI_API_KEY": "..." }, "config": "TOML text" }`。TOML 通常包含 `model_provider = "..."`、`model = "..."`、`model_reasoning_effort = "high"`，以及 `[model_providers.<id>]` 下的 `base_url`、`wire_api`、`requires_openai_auth`、`query_params` 等。CC Switch 写 live config 时会稳定 provider id，常量为 `ccswitch`，但 DB 中保存的是用户 provider 原始 TOML。Cradle reader 必须解析 TOML，不能用 regex 当正式实现。

对于 `gemini`，`settings_config` 常见结构是 `{ "env": { "GEMINI_API_KEY": "...", "GOOGLE_GEMINI_BASE_URL": "...", "GEMINI_MODEL": "..." }, "config": {...} }`。部分 preset 只填 `GOOGLE_GEMINI_BASE_URL` 与 `GEMINI_MODEL`，官方 OAuth 可能没有 API key。

对于 `claude-desktop`，CC Switch 使用自己的 `claude_desktop_config` validator，可能从 Claude provider 转换出 direct 或 proxy mode。Cradle 第一版不应把它当可运行 profile，因为 Cradle 没有 Claude Desktop 3P profile runtime。

对于 `opencode`，`settings_config` 是 OpenCode provider fragment，常见结构含 `npm`、`name`、`options.baseURL`、`options.apiKey`、`models`。对于 `openclaw`，常见结构含 `baseUrl`、`apiKey`、`api`、`models`。对于 `hermes`，常见结构含顶层 `apiKey`、`baseUrl` 或 Hermes provider-specific config。Cradle 第一版可以读取但标记 unsupported。

`providers.meta` 的字段很多，mirror 第一版建议保存以下字段到 Cradle metadata 中：`apiFormat`、`apiKeyField`、`providerType`、`authBinding`、`githubAccountId`、`costMultiplier`、`pricingModelSource`、`limitDailyUsd`、`limitMonthlyUsd`、`testConfig`、`usage_script`、`endpointAutoSelect`、`isPartner`、`partnerPromotionKey`、`custom_endpoints`、`codexFastMode`、`promptCacheKey`、`isFullUrl`、`commonConfigEnabled`。这些字段不一定都影响 runtime，但对 UI、成本、故障排查和未来扩展有价值。

## Local settings 与 current provider 规则

`~/.cc-switch/settings.json` 是设备级本地 settings，不随 CC Switch 云同步。它保存 `currentProviderClaude`、`currentProviderClaudeDesktop`、`currentProviderCodex`、`currentProviderGemini`、`currentProviderOpenCode`、`currentProviderOpenClaw`、`currentProviderHermes`，并且这些值优先于 DB `providers.is_current`。它也保存 live config directory overrides，比如 `claudeConfigDir`、`codexConfigDir`、`geminiConfigDir`、`opencodeConfigDir`、`openclawConfigDir`、`hermesConfigDir`。Mirror 不需要写这些字段，但 current selection 必须读取它们。

CC Switch app types 是固定字符串：`claude`、`claude-desktop`、`codex`、`gemini`、`opencode`、`openclaw`、`hermes`。其中 `opencode`、`openclaw`、`hermes` 是 additive mode，没有普通意义上的 single current provider；Claude、Claude Desktop、Codex、Gemini 是 switch mode。

Effective current provider 的计算必须复刻 CC Switch 逻辑。对 switch mode app，先读取 `settings.json` 中对应 key，并验证这个 ID 在 DB providers 中存在；如果存在，它就是 current。若 settings 中没有或 ID 不存在，fallback 到 `providers.is_current=1`。对 additive mode app，第一版返回 null。

App key 到 settings key 的映射：

- `claude` -> `currentProviderClaude`
- `claude-desktop` -> `currentProviderClaudeDesktop`
- `codex` -> `currentProviderCodex`
- `gemini` -> `currentProviderGemini`
- `opencode` -> `currentProviderOpenCode`
- `openclaw` -> `currentProviderOpenClaw`
- `hermes` -> `currentProviderHermes`

## Cradle current model（Cradle 当前模型）

Cradle `agent_profiles` 当前字段是 `id`、`name`、`providerKind`、`enabled`、`configJson`、`credentialRef`、`customModels`、`iconSlug`、timestamps。`providerKind` 现在只允许 `openai-compatible` 和 `anthropic`。这意味着 provider profile 只表达“API endpoint + model catalog + secret ref”，不表达 CC Switch 的 full app config。

Cradle `agent_credentials` 保存加密密钥，`apps/server/src/modules/secrets/service.ts` 使用 `CRADLE_CREDENTIAL_SECRET` 做 AES-256-GCM。已有 runtime 会优先通过 `credentialRef` 读取密钥。Mirror 实现要么复用这个 vault，要么先扩展 secret service 支持 upsert by stable external source key；不应把 CC Switch API key 直接写进 profile `configJson`。

Cradle OpenAI-compatible runtime 消费 `configJson.baseUrl`、`configJson.model`、`configJson.enabledModels`、`configJson.apiMode`、`configJson.maxMessages`。Cradle Claude Agent runtime 消费 `configJson.baseUrl`、`configJson.model`、`configJson.apiKey`、`configJson.claudeAgent.modelAliases`、`configJson.permissionMode` 等，并把它们转成 Claude Agent SDK options/env。Cradle Codex runtime 消费 `configJson.baseUrl`、`configJson.model`、`configJson.reasoningEffort`、`configJson.approvalPolicy`、`configJson.sandboxMode`、`configJson.additionalDirectories` 等。

因此第一版 mirror 的关键不是一比一复制 CC Switch app config，而是把 CC Switch provider 投影成 Cradle runtime 能执行的 profile config，同时把完整原始配置和 source fingerprint 保存在 Cradle-owned mirror metadata 中，方便后续刷新和调试。

## Plugin / SDK feasibility（插件与 SDK 可行性）

当前 Cradle plugin system 有三层。Server plugin 可以在 `/api/plugins/<routeSegment>` 下注册 HTTP routes，可以注册 MCP servers、skills、chat hooks、events，并使用 plugin-scoped storage。Web plugin 可以注册独立 panel 和 command。Desktop plugin 可以访问 Electron main 的 userData path、监听 webview、请求 browser panel tab，并把 shared config 通过环境变量传给 server plugin。这个能力足够做一个“CC Switch Inspector”插件：读取 CC Switch DB、展示 provider/MCP/skills/prompts/usage snapshot、提供手动 refresh、把发现结果作为只读 panel 展示。

当前 plugin system 不足以安全实现 first-class provider/profile mirror。原因有四个。第一，provider/profile mirror 必须写 `agent_profiles` 和 `agent_credentials`，并新增 mirror tracking tables；plugin SDK 没有 host-owned profile/secrets API，也没有 Drizzle migration API。第二，profile routes 需要阻止用户修改 mirrored rows；plugin 不能改变 core `/profiles` routes 的权限语义。第三，plugin storage 当前是 in-memory，不足以保存 source fingerprints、last sync status、external object mappings 或 stable credential refs。第四，web plugin 只能挂独立 panel/command，不能把 read-only badge、source status、manual sync 控件嵌入现有 provider settings 和 profile list。

因此推荐第一版实现为 core server module。Core module 负责所有影响 Cradle DB、profile、credential、runtime selection 和 settings UI 的语义；plugin 只能作为观察面板或后续外部 connector 的包装。若现在强行用 plugin 做 provider mirror，只能通过调用 Cradle HTTP routes 或 import 内部模块来写 profile/secret，这会绕开 owner 边界，也很难保证 transaction、migration、OpenAPI、CLI 和 UI 一致性。

如果未来要 plugin-first 实现，需要先补齐这些 SDK/host contract。Server plugin SDK 需要 `ctx.profiles.upsertExternalProfile`、`ctx.profiles.markExternalProfileMissing`、`ctx.secrets.upsertExternalSecret`、`ctx.externalSources.registerSource`、`ctx.externalSources.upsertSnapshot`、`ctx.watchFiles`、`ctx.scheduleTask`、`ctx.db.transactionForPluginSchema`，或者等价的 host-owned external source API。Web plugin SDK 需要 settings/provider surface contributions，例如 `ctx.registerSettingsSection`、`ctx.registerProfileBadge`、`ctx.registerProfileAction`、`ctx.registerProfileReadOnlyGuard`。Plugin storage 必须持久化到 Drizzle-managed `plugin_storage`，或者明确限制为 cache，不能继续把 mirror state 放在内存。OpenAPI/CLI 生成也要能发现 plugin-declared management routes，或者 core host 要提供统一 external source routes。

如果只做只读 CCDB catalog plugin，则可以现在实现。插件 server entry 读取 CC Switch DB 和 settings JSON，routes 提供 `GET /snapshot`、`POST /refresh`、`GET /status`；web entry 注册一个 “CC Switch” panel 展示 providers、MCP servers、skills、prompts、usage summaries 和 schema warnings；desktop entry 可选负责发现 userData 或本地路径。这个插件不能创建 Cradle profiles，不能保存 secrets，不能承诺 DB 变化后 Cradle runtime 自动使用新 provider；它只能作为调研/诊断 UI 或 core mirror 的辅助面板。

## Target architecture（目标架构）

新增一个 Cradle-owned capability，建议命名为 `external-provider-sources` 或 `provider-mirror`。它的 owner 是 Cradle provider/profile layer，不是 CC Switch。它只读 CC Switch files，写 Cradle 自己 DB。不要把代码放进 CC Switch namespace，也不要把 mirror 写回 `~/.cc-switch`。

架构上分两层。第一层是 source snapshot：读取 CC Switch DB、settings JSON 和可选 app path store，生成完整 `CcSwitchSnapshot`，包含 providers、MCP servers、prompts、skills、skill repos、proxy config、health、stream checks、usage summaries、model pricing 和 allowlisted settings。第二层是 object projections：只把有明确 Cradle owner 的对象投影成一等对象。第一版只投影 providers 到 `agent_profiles` / `agent_credentials`；其它对象先存 raw snapshot、counts、fingerprints 和 status，供 UI 展示和后续 owner-specific mirror 使用。

新增 DB 表建议如下。名称可以调整，但语义要保持。

    external_provider_sources
      id text primary key
      kind text not null
      label text not null
      enabled integer not null default 1
      config_json text not null default '{}'
      last_sync_status text not null default 'never'
      last_sync_error text
      last_sync_at integer
      created_at integer not null
      updated_at integer not null

对于 CC Switch source，`kind` 是 `cc-switch`，`config_json` 至少保存：

    {
      "dbPath": "/Users/<user>/.cc-switch/cc-switch.db",
      "settingsPath": "/Users/<user>/.cc-switch/settings.json",
      "appConfigDir": "/Users/<user>/.cc-switch",
      "enabledApps": ["claude", "codex", "gemini"],
      "includeUnsupportedApps": false
    }

新增 mirror mapping 表：

    external_provider_mirrors
      source_id text not null
      external_app_type text not null
      external_provider_id text not null
      profile_id text not null
      credential_ref text
      source_fingerprint text not null
      raw_provider_json text not null
      mapped_config_json text not null
      status text not null
      last_seen_at integer not null
      primary key (source_id, external_app_type, external_provider_id)

如果实现 CCDB 全量 snapshot，新增 generic object snapshot 表：

    external_source_snapshots
      source_id text not null
      object_kind text not null
      external_id text not null
      source_fingerprint text not null
      raw_json text not null
      status text not null
      last_seen_at integer not null
      primary key (source_id, object_kind, external_id)

`profile_id` 指向 `agent_profiles.id`。ID 必须稳定且可重建，建议格式 `cc-switch:<app_type>:<provider_id>` 经 URL-safe 或 hash 编码后落入 `agent_profiles.id`，例如 `cc-switch-claude-<sha256(provider_id).slice(0,16)>`。不要直接拼接未清洗的 provider id 到 SQL id 或 DOM id。

`source_fingerprint` 是 mirror 判断是否要更新的依据。它应至少 hash 以下内容：`app_type`、`provider.id`、`provider.name`、`settings_config` 原文、`meta` 原文、`website_url`、`category`、`sort_index`、`icon`、`icon_color`、相关 `provider_endpoints` rows、effective current provider id。不要把 hash 当安全机制；它只是变更检测。

Mirror sync service 的职责是：读取 CC Switch DB 与 settings JSON，生成 normalized snapshot，映射 provider 为 Cradle profile + credential + mirror row，在 transaction 中 upsert，并把已经消失的 external provider 标记为 disabled 或 archived。建议第一版不要硬删除 profile，因为 existing sessions 可能引用它；当 CC Switch provider 消失时，把 `agent_profiles.enabled=false`，mirror row `status='missing'`，UI 显示 “Removed in CC Switch”。对非 provider 对象，第一版只 upsert `external_source_snapshots`，不写 Cradle feature-owned tables。

## Mapping rules（字段映射规则）

对于 `claude`，默认创建 `providerKind='anthropic'` 的 `agent_profiles` 行。如果 `meta.apiFormat` 是 `openai_chat`、`openai_responses` 或 `gemini_native`，只有在 Cradle runtime 确认能直接访问该 endpoint 时，才映射为 `providerKind='openai-compatible'`。第一版更稳妥的选择是对 Claude Code-compatible endpoint 继续使用 `anthropic`，因为 Claude Agent runtime 理解 `ANTHROPIC_BASE_URL`。字段映射如下：

- `name`: `CC Switch / Claude / <provider.name>`
- `enabled`: 除非 provider 已被删除或不支持，否则为 true
- `configJson.baseUrl`: `settings_config.env.ANTHROPIC_BASE_URL`
- `configJson.model`: 优先使用 `settings_config.env.ANTHROPIC_MODEL`；否则使用 sonnet/opus/haiku aliases 中第一个非空值；仍不存在则为 undefined
- `configJson.claudeAgent.modelAliases.haiku`: `ANTHROPIC_DEFAULT_HAIKU_MODEL`
- `configJson.claudeAgent.modelAliases.sonnet`: `ANTHROPIC_DEFAULT_SONNET_MODEL`
- `configJson.claudeAgent.modelAliases.opus`: `ANTHROPIC_DEFAULT_OPUS_MODEL`
- `credentialRef`: 从 `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY` 创建的 secret
- `iconSlug`: 如果 CC Switch `icon` 匹配 Cradle icon slug，则使用该值；否则为 null
- `customModels`: 从 env aliases 中发现的非空 model IDs

对于 `codex`，创建一个供 `runtimeKind='codex'` session 使用的 profile。当前 schema 只有 `providerKind`，没有 runtime kind，因此该 profile 可以用 `providerKind='openai-compatible'` 表达 metadata，但 agent/session 必须选择 `runtimeKind='codex'`。字段映射如下：

- 使用 TOML parser 解析 `settings_config.config`。
- 从顶层 `model_provider` 得到 active provider id。
- 读取顶层 `model`。
- 读取顶层 `model_reasoning_effort`。
- 读取 `[model_providers.<active_provider_id>].base_url`。
- 读取 `[model_providers.<active_provider_id>].wire_api`；如果它是 `responses`，metadata profile 中设置 `configJson.apiMode='responses'`，同时保留 Codex runtime 需要的 `reasoningEffort`。
- API key 来自 `settings_config.auth.OPENAI_API_KEY`。
- `configJson.baseUrl`: active model provider `base_url`.
- `configJson.model`: top-level `model`.
- `configJson.reasoningEffort`: top-level `model_reasoning_effort` normalized to Cradle enum where possible.
- 不支持的一般 TOML 字段保存在 `configJson.ccSwitch.codexToml` 或 mirror raw JSON 中，不放进 first-class runtime config。

对于 `gemini`，只有当 base URL 是 OpenAI-compatible gateway 时，才创建 `providerKind='openai-compatible'`。如果 base URL 是 Google native `generativelanguage.googleapis.com`，Cradle 当前 `createLanguageModel` 虽然能在标准 runtime 中识别 Google，但 `providerKind` 仍缺少 `google` variant。第一版可以把 Gemini official/native provider 映射为 disabled mirror row，状态为 `unsupported-runtime`，直到 Cradle schema 增加 `google` provider kind。如果启用映射，字段如下：

- `configJson.baseUrl`: `settings_config.env.GOOGLE_GEMINI_BASE_URL`
- `configJson.model`: `settings_config.env.GEMINI_MODEL`
- `credentialRef`: 来自 `settings_config.env.GEMINI_API_KEY` 的 secret
- `providerKind`: compatible relay 使用 `openai-compatible`；未来 Cradle schema 支持后再使用 `google`

对于 `universal_providers`，读取 DB `settings.key='universal_providers'` 并解析为 JSON map。每个 universal provider 包含 `id`、`name`、`providerType`、`apps`、`baseUrl`、`apiKey`、`models`、`websiteUrl`、`notes`、`icon`、`iconColor`、`meta`、`createdAt`、`sortIndex`。如果它生成的 child providers 已经存在于 `providers`，例如 ID 为 `universal-claude-<id>`、`universal-codex-<id>`、`universal-gemini-<id>`，则不要把 universal provider 额外当作独立 runtime profile。除非 child rows 缺失且实现者明确选择生成 mirror-only projection，否则只把它作为 metadata 使用。

## Sync semantics（同步语义）

Mirror sync 必须在三种情况下运行：server startup、用户显式点击同步、文件变化事件。启动同步给出正确初始状态；手动同步用于恢复 watcher 漏事件；文件 watcher 满足“CC Switch DB 变化后 Cradle 侧得到变化”的镜像语义。

需要 watch 的路径包括：

- CC Switch DB path，默认 `~/.cc-switch/cc-switch.db`
- SQLite sidecar paths：`cc-switch.db-wal` 和 `cc-switch.db-shm`
- CC Switch local settings path，默认 `~/.cc-switch/settings.json`
- 可选的 `app_paths.json` Tauri store path，仅当 Cradle 后续实现 CC Switch app config dir override 自动发现时才 watch

SQLite 写入可能使用 WAL，事件会成批出现。Watcher event 应 debounce 300-1000ms，然后执行 full sync。第一版不要做 row-level incremental sync。全量同步更简单，也更安全，因为 provider rows 数量较小。

读取 CC Switch DB 时必须使用 read-only 连接。在 Node/better-sqlite3 中，若库支持 readonly connection，应优先使用。连接后执行：

    PRAGMA query_only = ON;
    PRAGMA busy_timeout = 1000;

如果 DB 被锁或暂时无法读取，记录 sync status `blocked` 或 `error`，保留上一次 mirror rows，并等待下一次 watcher event 或手动 sync。不要因为一次读取失败就删除或 disable mirror rows。

当 source fingerprint 改变时，upsert profile 和 credential。当 source provider 在一次成功 sync 后消失时，disable 对应 profile 并把 mirror status 设为 `missing`。当 source reappears，再 re-enable 并更新。这让重复 sync 保持幂等。

## Plan of Work（实施计划）

首先，在 `packages/db/src/schema/` 下新增 external sources、provider mirror mappings、generic external source snapshots 的 Cradle-owned schema，并添加 Drizzle migration。更新 schema exports 和相关 README。这个 schema 是 Cradle 自己的投影，不应把 CC Switch 表名原样搬进 Cradle 当作本地所有权模型。

第二，在 `apps/server/src/modules/provider-mirror/` 或 `apps/server/src/modules/external-provider-sources/` 下创建 server module。模块包含 README、CC Switch reader、snapshot normalizer、mapping functions、sync service、watcher 和 HTTP routes。Reader 只读外部 SQLite 必需表与 allowlisted settings keys；mapping functions 必须是纯函数，并用 fixture rows 做单元测试；sync service 负责 Cradle DB transaction 和 secrets。

第三，扩展 secret persistence，使 mirrored secret 能稳定 upsert。当前 `saveSecret` 每次生成随机 ID；mirror 需要根据 source key 更新密钥，避免每次 sync 生成新 credential。可以增加 Cradle-owned source secret mapping 表，指向最新 random secret，并在 profile 更新后清理旧 mirror-created secrets。

第四，添加 API routes。最低限度：

    GET /provider-mirrors/sources
    PUT /provider-mirrors/sources/cc-switch
    POST /provider-mirrors/sources/:sourceId/sync
    GET /provider-mirrors/sources/:sourceId/status

`PUT` route 配置 DB path、settings path 和 enabled apps。`POST` route 运行 sync 并返回 counts：`added`、`updated`、`unchanged`、`disabled`、`unsupported`、`errors`。

第五，增加 snapshot/status routes。最低限度：

    GET /provider-mirrors/sources/:sourceId/snapshot
    GET /provider-mirrors/sources/:sourceId/objects
    GET /provider-mirrors/sources/:sourceId/objects/:objectKind

这些 routes 让 UI 和调试工具能看到 CC Switch 中除 provider 之外的对象。返回内容必须 mask secret-like fields，例如 API keys、tokens、authorization headers、passwords。原始 snapshot 可以在 DB 内加密或只保存脱敏后的 raw；如果需要保存完整 raw secret-bearing provider config，则必须走 secrets vault 或受限 debug export，不要默认明文落库。

第六，集成 profile listing。现有 `GET /profiles` 可以继续返回 mirror rows，因为它们是真实 `agent_profiles`；UI 应通过 mirror metadata 识别它们并渲染 read-only badge。如果 UI 需要 source badge 且不想额外请求，新增一个 join mirror mapping 的 provider profile projection endpoint。不要让原生 profile update routes 修改 CC Switch mirror rows。

第七，在 server lifecycle 注册 file watcher。Watcher 失败时降级为 startup/manual sync，不应阻塞 server。Electron desktop mode 下路径要从真实 user home 解析，不能从 packaged app cwd 推导。

第八，在 settings/providers UI 中添加入口。它应允许用户启用 CC Switch mirror、显示检测到的 DB path、显示 sync status、提供 manual sync button，并把 mirrored profiles 标为 read-only。它不应要求用户重新输入已存在于 CC Switch 中的 API key。另加一个 read-only CCDB catalog view，展示检测到的 MCP servers、prompts、skills、usage summaries、pricing 和 proxy status，并明确哪些对象当前只是观察，不会自动写入 Cradle。

如果选择 plugin-first 路线，先不要实现 provider/profile mirror。先新增 SDK/host capabilities：持久 plugin storage、external source registry、profile upsert guard、external secret upsert、file watcher、settings surface contributions、profile badge/action/read-only guard。补齐这些 API 并通过 plugin host tests 后，再把 CC Switch integration 作为 plugin 实现。没有这些 API 时，plugin 只能做 inspector panel。

## Concrete Steps（具体步骤）

从仓库根目录 `/Users/wibus/dev/Cradle` 开始，先检查当前工作区，避免覆盖无关改动：

    git status --short

新增 schema 和 migration。预期文件：

    packages/db/src/schema/provider-mirror.ts
    packages/db/src/schema/index.ts
    packages/db/drizzle/<next>_provider_mirror.sql
    packages/db/drizzle/meta/_journal.json
    packages/db/src/schema/README.md

新增 server module。预期文件：

    apps/server/src/modules/provider-mirror/README.md
    apps/server/src/modules/provider-mirror/index.ts
    apps/server/src/modules/provider-mirror/model.ts
    apps/server/src/modules/provider-mirror/service.ts
    apps/server/src/modules/provider-mirror/cc-switch-reader.ts
    apps/server/src/modules/provider-mirror/cc-switch-snapshot.ts
    apps/server/src/modules/provider-mirror/cc-switch-mapper.ts
    apps/server/src/modules/provider-mirror/watcher.ts

在 `apps/server/src/app.ts` 注册新 module，位置与 `profiles`、`providers` 等现有模块并列。

新增 server tests fixture，不要包含真实密钥：

    apps/server/tests/fixtures/cc-switch/user-version-8.sql
    apps/server/tests/provider-mirror.test.ts
    apps/server/tests/cc-switch-snapshot.test.ts

Fixture SQL 应创建 `providers`、`provider_endpoints`、`settings`、`mcp_servers`、`prompts`、`skills`、`skill_repos`、`proxy_config`、`provider_health`、`stream_check_logs`、`model_pricing`、`usage_daily_rollups` 并插入 fake rows。Fake secret 可以用 `test-anthropic-key` 和 `test-openai-key`。Reader test 必须证明 secrets 在 HTTP snapshot response 中被 redacted。

实现后运行聚焦测试：

    pnpm --filter @cradle/server exec vitest run tests/provider-mirror.test.ts tests/sdk-providers.test.ts
    pnpm --filter @cradle/server exec vitest run tests/cc-switch-snapshot.test.ts

如果新增 routes，运行 OpenAPI/schema tests：

    pnpm --filter @cradle/server exec vitest run tests/openapi.test.ts

如果 DB schema 有变更，运行仓库里用于 fresh DB 和 migration 的相关 server/db 测试。若没有单独命令，就至少运行初始化 fresh DB 的 server test set。

## Validation and Acceptance（验证与验收）

验收要求证明行为，而不只是证明代码存在。

创建一个临时 CC Switch DB fixture，其中包含两个 Claude providers 和一个 Codex provider。把 Cradle source path 指向该临时 DB 和临时 settings JSON。运行 sync。预期结果：Cradle 在 `agent_profiles` 创建 mirror rows，为 fake secrets 创建 credential refs，在 mirror metadata 中标记一个 Claude provider 为 current，并返回 added counts。

更新 fixture DB 中的 provider name 和 model。再次运行 sync。预期结果：同一个 Cradle profile ID 被原地更新，不产生重复 profile。`updated` count 增加，`source_fingerprint` 改变。

只修改 settings JSON，把 current provider 从 Claude provider A 切到 provider B，不改 DB `is_current`。运行 sync。预期结果：mirror metadata/current projection 跟随 settings JSON 中的 provider B。这证明 current selection 的优先级与 CC Switch 一致。

从 fixture DB 删除一个 source provider row。运行 sync。预期结果：Cradle disable 对应 mirror profile，并将 mirror status 标记为 `missing`，但已有引用该 profile 的 sessions 仍然可查询。

模拟 DB locked 或 unreadable。预期结果：sync 返回 error status，上一轮 mirror rows 保持不变，Cradle 不基于失败读取删除或 disable rows。

Claude runtime 验证：使用 mirrored Claude profile 启动 chat session，并 mock Claude Agent SDK 或 test secret reader。预期结果：`ClaudeAgentProvider` 收到从 CC Switch env 派生出的 `ANTHROPIC_API_KEY`、可选 `ANTHROPIC_BASE_URL` 和 model aliases。

Codex runtime 验证：使用 mirrored Codex profile，并 mock Codex SDK。预期结果：`CodexProvider` 从 `credentialRef` 读取 API key，从 active TOML `[model_providers.<id>]` 读取 base URL，从 top-level TOML `model` 读取 model，从 top-level TOML `model_reasoning_effort` 读取 reasoning effort。

CCDB catalog validation：fixture 中插入一个 MCP server、一个 prompt、一个 skill、一个 pricing row、一个 proxy config row、一个 provider health row。运行 snapshot sync。预期结果：provider projection 仍然只创建 provider profiles；`external_source_snapshots` 中有这些对象的 redacted raw JSON、fingerprint、status 和 counts；UI/API snapshot 能展示它们，但不会自动写 Cradle skills、workflow rules、usage logs 或 MCP registry。

Plugin 可行性验证：在当前 SDK 不扩展的前提下，实现者不得选择 plugin 作为 provider mirror 的 source of truth。若后续补 SDK，则必须有 plugin host tests 证明 plugin 可以持久保存 external source mapping、在 transaction 中调用 host-owned profile/secret upsert、注册 settings UI contribution，并阻止 core profile edit routes 修改 external mirrored rows。

在这些场景有自动化测试或带 fake secrets 的手动 transcript 之前，不要把实现标为完成。

## Idempotence and Recovery（幂等与恢复）

同步算法必须幂等。对未变化的 CC Switch 文件重复运行 sync，第一次之后应产生 zero updates。它不应创建新 credentials、重复 profiles 或重排无关 Cradle profiles。

如果 sync 中途失败，Cradle DB writes 必须在 transaction 中。只有 profile rows、mirror rows 和 credential refs 都一致更新后，才把 `last_sync_at` 写为 success。如果 secret upsert 成功但 DB transaction 失败，下一次 sync 可以复用或替换该 secret；metadata 必须足够避免 secret 无界增长。

如果 CC Switch DB path 错误，保留 source config 但标记 status error。不要删除既有 mirror profiles，因为用户可能只是临时断开了同步目录。

如果 CC Switch schema 比已知版本更新，只读取已知列并保留 known fields 的 raw row JSON。如果必需列 `id`、`app_type`、`name`、`settings_config` 缺失，sync 应失败并返回清晰 incompatible schema error。

## Artifacts and Notes（证据与备注）

本计划的调研命令包括：

    cd /Users/wibus/dev/safe-research/cc-switch
    rg --files -g 'src-tauri/**' -g '*.rs' -g '*.ts'
    sed -n '1,260p' src-tauri/src/database/schema.rs
    sed -n '1,360p' src-tauri/src/database/dao/providers.rs
    sed -n '600,695p' src-tauri/src/settings.rs

对真实本机 CC Switch DB 只读取了结构信息：

    sqlite3 "$HOME/.cc-switch/cc-switch.db" "PRAGMA user_version; SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('providers','provider_endpoints','settings') ORDER BY name;"

观察到的输出摘录：

    8
    provider_endpoints|CREATE TABLE provider_endpoints (...)
    providers|CREATE TABLE providers (...)
    settings|CREATE TABLE settings (...)

对真实本机 settings JSON 只检查了 key 名：

    {
      "exists": true,
      "keys": [
        "visibleApps",
        "currentProviderClaude",
        "currentProviderCodex"
      ]
    }

本文件没有复制真实 provider rows、API keys、auth JSON 或完整 settings 内容。

## Interfaces and Dependencies（接口与依赖）

使用 `better-sqlite3` 或仓库已有 SQLite access library 只读访问 CC Switch DB。不要用 raw SQL 写 Cradle-owned DB；仓库规则要求 Cradle DB interactions 使用 Drizzle。读取 CC Switch 外部 DB 时使用 SQL 是合理的，因为它不是 Cradle-owned schema，也没有 Drizzle schema。

Codex config 必须用真实 TOML parser。不要在 Cradle 实现里用 regex 解析 `base_url` 或 `model`。CC Switch 里有 regex extraction helper，但 Cradle 应使用结构化解析以保证长期可维护。

文件 watcher 可以使用 `chokidar` 或仓库已有 watcher dependency。如果新增 watcher dependency 被认为过宽，可以先实现 startup/manual sync，并把 watcher 作为第二 milestone；但在 watcher 或等效 change detection 完成前，不能声称满足“DB 改变后 Cradle 侧得到改变”的完整目标。

CC Switch reader 应暴露纯 TypeScript interface：

    export interface CcSwitchProviderRow {
      id: string
      appType: string
      name: string
      settingsConfig: unknown
      websiteUrl: string | null
      category: string | null
      createdAt: number | null
      sortIndex: number | null
      notes: string | null
      icon: string | null
      iconColor: string | null
      meta: Record<string, unknown>
      isCurrent: boolean
      endpoints: Array<{ url: string, addedAt: number | null }>
    }

    export type CcSwitchObjectKind =
      | 'provider'
      | 'mcp-server'
      | 'prompt'
      | 'skill'
      | 'skill-repo'
      | 'proxy-config'
      | 'provider-health'
      | 'stream-check'
      | 'usage-rollup'
      | 'model-pricing'
      | 'setting'

    export type CcSwitchMirrorStage =
      | 'provider-projection'
      | 'read-only-catalog'
      | 'metadata-only'
      | 'unsupported'

    export interface CcSwitchSnapshotObject {
      kind: CcSwitchObjectKind
      externalId: string
      appType: string | null
      sourceFingerprint: string
      stage: CcSwitchMirrorStage
      status: 'available' | 'unsupported' | 'invalid' | 'redacted'
      raw: Record<string, unknown>
      redactedRaw: Record<string, unknown>
      warnings: string[]
    }

    export interface CcSwitchProxyConfigObject {
      appType: 'claude' | 'codex' | 'gemini'
      proxyEnabled: boolean
      listenAddress: string | null
      listenPort: number | null
      enableLogging: boolean
      autoFailoverEnabled: boolean
      liveTakeoverActive: boolean
      raw: Record<string, unknown>
    }

    export interface CcSwitchProviderHealthObject {
      providerId: string
      appType: string
      isHealthy: boolean
      consecutiveFailures: number
      lastSuccessAt: number | null
      lastFailureAt: number | null
      lastError: string | null
      updatedAt: number | null
    }

    export interface CcSwitchUsageSummary {
      appType: string
      providerId: string | null
      requestCount: number
      successCount: number
      totalCostUsd: number
      latestCreatedAt: number | null
    }

    export interface CcSwitchSnapshotCounts {
      providers: number
      mcpServers: number
      prompts: number
      skills: number
      skillRepos: number
      proxyConfigs: number
      providerHealthRows: number
      streamCheckRows: number
      usageRollups: number
      modelPricingRows: number
      settings: number
    }

    export interface CcSwitchSnapshot {
      dbPath: string
      settingsPath: string
      userVersion: number
      providers: CcSwitchProviderRow[]
      effectiveCurrentByApp: Record<string, string | null>
      universalProviders: Record<string, unknown>
      objects: CcSwitchSnapshotObject[]
      proxyConfigs: CcSwitchProxyConfigObject[]
      providerHealth: CcSwitchProviderHealthObject[]
      usageSummaries: CcSwitchUsageSummary[]
      allowlistedSettings: Record<string, unknown>
      counts: CcSwitchSnapshotCounts
      schemaWarnings: string[]
      readAt: number
    }

`raw` 只允许在 server 内部使用。所有 HTTP response、plugin panel、日志和 debug export 默认使用 `redactedRaw`。Redaction 必须覆盖 key 名包含 `key`、`token`、`secret`、`password`、`authorization`、`auth_token`、`api_key` 的字段，也要覆盖常见 env key，如 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`GEMINI_API_KEY`。Provider projection 可以把 secret value 传给 secret service，但不能把原始 secret 放进 `external_source_snapshots.raw_json` 的明文存储；若必须保存完整 raw provider config，应把 secret-bearing 子树拆到 vault 或加密列中。

通用 snapshot mapper 应暴露：

    export interface ExternalSourceSnapshotObject {
      sourceId: string
      objectKind: CcSwitchObjectKind
      externalId: string
      sourceFingerprint: string
      rawJson: Record<string, unknown>
      redactedJson: Record<string, unknown>
      status: 'available' | 'unsupported' | 'invalid' | 'missing'
      lastSeenAt: number
    }

    export function mapCcSwitchSnapshotObjects(input: {
      sourceId: string
      snapshot: CcSwitchSnapshot
    }): ExternalSourceSnapshotObject[]

Provider mapper 应暴露纯函数：

    export interface MirrorProfileProjection {
      profileId: string
      name: string
      providerKind: 'openai-compatible' | 'anthropic'
      enabled: boolean
      config: Record<string, unknown>
      secret: { kind: string, label: string, value: string } | null
      iconSlug: string | null
      customModels: Array<{ id: string, label: string }>
      status: 'ready' | 'unsupported-runtime' | 'missing' | 'invalid'
      sourceFingerprint: string
      rawProvider: Record<string, unknown>
    }

    export function mapCcSwitchProviderToMirrorProfile(input: {
      sourceId: string
      provider: CcSwitchProviderRow
      effectiveCurrentProviderId: string | null
    }): MirrorProfileProjection

同步服务应暴露：

    export interface SyncProviderMirrorResult {
      sourceId: string
      added: number
      updated: number
      unchanged: number
      disabled: number
      unsupported: number
      errors: Array<{ providerId?: string, appType?: string, message: string }>
    }

    export async function syncProviderMirrorSource(sourceId: string): Promise<SyncProviderMirrorResult>

如果未来选择 plugin-first 路线，host SDK 至少需要暴露以下能力。接口名称可以调整，但所有语义都必须由 host 实现，plugin 只能请求，不应直接 import Cradle internals 或自行写 host DB：

    export interface ExternalProfileInput {
      sourceId: string
      externalObjectId: string
      displayName: string
      providerKind: 'openai-compatible' | 'anthropic' | 'google'
      enabled: boolean
      config: Record<string, unknown>
      credentialRef: string | null
      sourceFingerprint: string
      rawMetadata: Record<string, unknown>
      readOnlyReason: string
    }

    export interface ExternalSourceHostApi {
      registerSource(input: {
        kind: string
        label: string
        config: Record<string, unknown>
      }): Promise<{ sourceId: string }>

      upsertSnapshotObject(input: ExternalSourceSnapshotObject): Promise<void>

      upsertExternalProfile(input: ExternalProfileInput): Promise<{ profileId: string }>

      markExternalProfileMissing(input: {
        sourceId: string
        externalObjectId: string
      }): Promise<void>

      upsertExternalSecret(input: {
        sourceId: string
        externalObjectId: string
        label: string
        value: string
      }): Promise<{ credentialRef: string }>

      watchFiles(input: {
        paths: string[]
        debounceMs: number
        onChangeEvent: string
      }): Promise<Disposable>
    }

    export interface SettingsSurfaceApi {
      registerSettingsSection(input: {
        id: string
        title: string
        order: number
      }): Disposable

      registerProfileBadge(input: {
        sourceKind: string
        label: string
      }): Disposable

      registerProfileReadOnlyGuard(input: {
        sourceKind: string
        message: string
      }): Disposable
    }

这些 host APIs 的验收标准是：plugin 不需要知道 `agent_profiles`、`agent_credentials`、Drizzle migrations 或 profile route internals；host 在 transaction 中更新 external source、profile、secret 和 snapshot mapping；core profile edit routes 能基于 host-owned metadata 阻止用户修改 mirrored profiles；web surface 能在 provider settings/profile list 中显示 badge、status 和 manual sync action。未满足这些条件前，CC Switch plugin 只能是 inspector，不是 mirror source of truth。

Revision note: 初版调研规格基于 CC Switch 源码、真实本机 DB 结构只读检查和 Cradle provider/runtime schema 检查创建；随后补齐完整 CC Switch DB 表结构总览，并统一正文为中文；本次修订扩展 CCDB catalog snapshot interfaces、redaction 约束和 plugin-first host API 缺口，使文档能直接指导 provider mirror 与只读 CCDB inspector 两条实现路线。

Revision note: 2026-05-21 11:41Z 修订记录 Plugin SDK / Host 已升级为 fixed-shape external provider source 架构，并新增 `plugins/cc-switch` 作为真实 CC Switch reader。旧的“core source 优先”决策保留为历史记录，但后续实施以 plugin source + host projection 为准。
