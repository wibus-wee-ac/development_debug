# 20260606 Web Runtime Release Audit E

## 范围

审计范围：web app runtime/UI integration、generated API client freshness、onboarding/settings/chat/workspace critical paths。  
约束：不修改源码；仅运行只读检查与构建/测试命令；只写本 handoff markdown。

## 执行过的检查

- `pnpm --filter @cradle/web exec tsc --noEmit`
- `pnpm --filter @cradle/server exec tsc --noEmit`
- `pnpm --filter @cradle/web build`
- `pnpm --filter @cradle/web test`
- `pnpm --filter @cradle/web run i18n:check`
- `pnpm --filter @cradle/server test`
- `CRADLE_DATA_DIR=/tmp/cradle-release-audit-data pnpm --filter @cradle/server exec tsx ...`

## 结论

当前不建议进入 private release test。主要 blocker 是 web typecheck 失败、web/server 测试失败、设置/聊天运行时文案缺失、API 生成类型与 UI 集成不一致，以及 web build 命令在完成产物后启动 Vite DevTools 并滞留进程。

## Blockers

### Critical - Web TypeScript 不通过

证据：

- 命令：`pnpm --filter @cradle/web exec tsc --noEmit`
- 结果：exit code `2`
- 报错集中在 [apps/web/src/features/agent-management/agent-list.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/agent-management/agent-list.tsx:89)：
  - `auto` 出现在 `thinkingLabelKeys` / `thinkingDescriptionKeys`，但 `AgentBatchThinkingEffort` 映射不接受该值。
  - `selectedAgent` 传入 [AgentDetailPage](/Users/wibus/dev/Cradle/apps/web/src/features/agent-management/agent-list.tsx:1115) 时，`thinkingEffort` 类型包含 `auto`，但详情页只接受 concrete thinking effort。
- 根因证据：
  - [apps/web/src/features/agent-management/agent-batch-configuration.ts](/Users/wibus/dev/Cradle/apps/web/src/features/agent-management/agent-batch-configuration.ts:4) 的 batch 类型包含 `auto`。
  - [apps/web/src/api-gen/types.gen.ts](/Users/wibus/dev/Cradle/apps/web/src/api-gen/types.gen.ts:2267) 的 generated `GetAgentsResponse` 包含 `auto | none | minimal | low | medium | high | xhigh | max`。
  - [packages/db/drizzle/0063_agent_thinking_effort_concrete.sql](/Users/wibus/dev/Cradle/packages/db/drizzle/0063_agent_thinking_effort_concrete.sql:45) 把旧数据 `auto` 迁到 `high`，但 [packages/db/src/schema/identity.ts](/Users/wibus/dev/Cradle/packages/db/src/schema/identity.ts:38) 与 [apps/server/src/modules/agent-identity/service.ts](/Users/wibus/dev/Cradle/apps/server/src/modules/agent-identity/service.ts:39) 仍允许 `auto`。

影响：

private release test 无法以 typecheck 作为准入；agent settings 是 onboarding/settings/chat 的关键入口，生成 API 类型变化已经传播到 UI。

置信度：High。

### Critical - Web 测试不通过

证据：

- 命令：`pnpm --filter @cradle/web test`
- 结果：5 个 test files failed，12 个 tests failed。
- 代表性失败：
  - [apps/web/src/lib/query-refresh-policy.test.ts](/Users/wibus/dev/Cradle/apps/web/src/lib/query-refresh-policy.test.ts:7) 期望 `refetchIntervalInBackground: false`，实现 [apps/web/src/lib/query-refresh-policy.ts](/Users/wibus/dev/Cradle/apps/web/src/lib/query-refresh-policy.ts:55) 返回 `true`。
  - [apps/web/src/store/browser-panel.test.ts](/Users/wibus/dev/Cradle/apps/web/src/store/browser-panel.test.ts:122) 期望 request tab fulfillment 保留 session source metadata，但实际 tab 为 `undefined`。
  - [apps/web/src/features/browser/browser-panel.test.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/browser/browser-panel.test.tsx:97) 多个 BrowserPanel 场景只渲染 fallback；实现 [apps/web/src/features/browser/browser-panel.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/browser/browser-panel.tsx:918) 在非 Electron 环境直接返回 `Browser Panel is available in the desktop app.`。
  - [apps/web/src/features/kanban/kanban-parent-issue-link.test.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/kanban/kanban-parent-issue-link.test.tsx:93) 报 `No QueryClient set`；[apps/web/src/features/kanban/kanban-card.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/kanban/kanban-card.tsx:207) 新增 `useAgents()` runtime hook 边界后，测试没有 provider wrapper。

影响：

workspace/browser/kanban critical path 的回归网失效，且 BrowserPanel 测试失败直接覆盖 chat-to-browser prompt ingress、source session routing、webview reload 防回归。

置信度：High。

### High - Server 测试不通过，影响 API/runtime 信任链

证据：

- 命令：`pnpm --filter @cradle/server test`
- 结果：10 个 test files failed，14 个 tests failed，1 个 suite import failure。
- 代表性失败：
  - `tests/pty-websocket.test.ts` import `ws` 失败：`Cannot find package 'ws'`。
  - `tests/pty.test.ts` 仍插入 `sessions.agent_profile_id`，数据库表已无该列。
  - `tests/external-provider-sources.test.ts` 期望 `modelRegistryMappingsJson`，实际 response 缺失。
  - `tests/automation.test.ts` 多个 automation critical path 失败，run-now 变为 `status: failed`，错误为 `Session requires a provider target or an agent`。
  - `tests/chronicle.test.ts` duplicate accessibility event 返回 `500`，Zod 报 `provider` 缺失。

影响：

虽然 `pnpm --filter @cradle/server exec tsc --noEmit` 通过，但 server 行为测试覆盖 preferences、provider source、automation、PTY/session runtime 等 release-test 依赖路径，目前不能作为稳定后端基线。

置信度：High。

### High - i18n 缺失会泄露 key 到 settings/chat UI

证据：

- 命令：`pnpm --filter @cradle/web run i18n:check`
- 结果：exit code `1`
- 摘要：`missingKeys: 61`，`extraKeys: 0`，`invalidEntries: 0`。
- 报告文件：`apps/web/i18n-missing-report.json`。
- 缺失分布：
  - `zh-CN/settings`: 15 个 `chat.titleGeneration.*`
  - `ja-JP/chat`: 8 个 `runtimeSettings.*`
  - `ja-JP/settings`: 15 个 `chat.titleGeneration.*`
  - `es-ES/chat`: 8 个 `runtimeSettings.*`
  - `es-ES/settings`: 15 个 `chat.titleGeneration.*`
- 使用位置：
  - [apps/web/src/features/settings/chat-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/chat-settings.tsx:35)
  - [apps/web/src/features/chat/runtime-settings-control.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/runtime-settings-control.tsx:1)

影响：

settings/chat 是本轮明确 critical path。非默认 locale 下会出现 untranslated key 或 fallback，不适合作为 private release test 默认体验。

置信度：High。

### High - Generated API client 与 UI 集成仍不一致

证据：

- `apps/server/openapi.json` 与临时导出的 clean OpenAPI 一致：
  - `apps/server/openapi.json 1572984 1c33838c6f4f13c92504f211e0d0ddb1c97dc539010606352ba01365ad2da4f4`
  - `/tmp/cradle-current-openapi.clean.json 1572984 1c33838c6f4f13c92504f211e0d0ddb1c97dc539010606352ba01365ad2da4f4`
- `apps/web/src/api-gen` 已有大量 working-tree 变更，包含新增 `/preferences/desktop`、`/sessions/{id}/read`、`/chat/sessions/{sessionId}/runtime-settings` 等接口。
- 但 fresh generated types 已经把 agent `thinkingEffort` 扩展为 `auto | none | minimal | low | medium | high | xhigh | max`，而 UI detail/batch 层仍在 concrete union 与 `auto` 之间摇摆，直接导致 web typecheck 失败。

影响：

问题不在 server OpenAPI snapshot 陈旧，而在 generated API surface 被更新后，agent settings UI 没有完成语义收敛。release test 中 agent import、agent settings、chat model/thinking selection 都会踩到这一层。

置信度：High。

### Medium - Web build 成功但命令行为不适合作为 release gate

证据：

- 命令：`pnpm --filter @cradle/web build`
- 结果：产物构建成功，`✓ built in 2m 25s`。
- 但 build 后输出：`[DTK0008] Client authentication is disabled...` 与 `Vite DevTools started at http://localhost:10000`。
- [apps/web/vite.config.ts](/Users/wibus/dev/Cradle/apps/web/vite.config.ts:92) 配置 `devtools.enabled: true`。
- 进程检查发现 `pnpm --filter @cradle/web build` / Vite build 残留进程，已仅终止本次审计启动的 build 残留。

影响：

build 本身能产出 dist，但 release-test gate 不应在 build 完成后启动 unauthenticated devtools 服务并保持进程。CI/本地 release rehearsal 可能卡住或暴露 filesystem/dev server access。

置信度：Medium-High。

## 非阻断但需要排队

- `pnpm --filter @cradle/server test` 中 automation、Chronicle、PTY、provider mapping、usage analytics 的失败数量较多，建议按 capability owner 分派，而不是作为 web runtime 单点修复。
- BrowserPanel 单元测试目前依赖非 Electron 环境模拟，但实现用 static `isElectron` 常量早退；需要明确测试边界是 mock Electron bridge 还是把 browser chrome 逻辑拆出。

## 当前可接受项

- `pnpm --filter @cradle/server exec tsc --noEmit` 通过。
- `pnpm --filter @cradle/web build` 的 bundle 构建完成；失败点是命令后置 DevTools 行为和缺少 typecheck gate。
- `apps/server/openapi.json` 与当前 server app 导出的 normalized OpenAPI 已一致。

## 建议 release-test 准入门槛

1. `pnpm --filter @cradle/web exec tsc --noEmit` 必须通过。
2. `pnpm --filter @cradle/web test` 必须通过，至少恢复 BrowserPanel、query refresh、Kanban runtime provider 边界测试。
3. `pnpm --filter @cradle/web run i18n:check` 必须通过，补齐 chat runtime settings 与 settings title generation keys。
4. `pnpm --filter @cradle/web build` 不应启动或滞留 Vite DevTools 服务。
5. agent `thinkingEffort` 语义需要在 DB schema、server model、generated API、AgentList、AgentDetail、composer toolbar 之间统一。
