# Session Await Audit

本报告记录 2026-05-31 对 Session Await 功能的重新审计。审计范围包括 server lifecycle、DB schema、CLI agent UX、web await panel、系统 workflow 文档和用户文档。

## Findings

### P0: Unknown sources could create permanent pending awaits

旧注册路径接受任意 `source` 字符串。没有 poller source 的记录会保持 `pending`，agent 结束 turn 后没有任何后台机制能恢复它。

Fix:

- `apps/server/src/modules/session-await/service.ts` 在 registration 入口验证 source，仅允许 `github-ci`、`github-review`、`manual`、`timer`。
- `manual` 被定义为显式 trigger-only source。
- `timer` 必须提供 `fireAt`，非 timer 不允许 `fireAt`。

Validation:

- `apps/server/tests/session-await.test.ts` 覆盖 unsupported source、manual await、timer/fireAt 组合。

### P0: Source failure and resume delivery failure were conflated

旧逻辑把 source 不可达和 Chat Runtime enqueue 失败都投影成 `failed`。这会导致两类问题：

- source failure 不能 retry delivery，因为外部条件从未成立。
- delivery failure 可以恢复，但旧记录没有稳定保存 resume text，无法可靠重投递。

Fix:

- `packages/db/src/schema/session-await.ts` 增加 `resumeText` 和 `failureKind`。
- `packages/db/drizzle/0053_military_longshot.sql` 增加对应 SQLite 列。
- `trigger()` 在 source matched 后保存 `resumeText` 和 payload。
- Chat Runtime enqueue 失败标记为 `failureKind: "delivery"`。
- Poller/source failure 标记为 `failureKind: "source"`。
- 新增 `POST /session-awaits/:id/retry-delivery`，只允许 delivery failure retry。

Validation:

- `apps/server/tests/session-await.test.ts` 覆盖 delivery failure、delivery retry、source failure 不可 retry、成功 trigger。

### P1: Agent-facing CLI exposed raw JSON instead of task-shaped commands

旧推荐命令是 `cradle session await-create --source ... --filter-json ...`。这要求 agent 拼 JSON、记住 source-specific filter shape，并重复传环境变量，实际使用成本过高。

Fix:

- 新增 `packages/cli/src/commands/session-await.ts` 手写 wrapper，不修改 generated files。
- 新命令：
  - `cradle session await github-ci <repo> --pr <n>|--sha <sha>|--run-id <id>`
  - `cradle session await github-review <repo> --pr <n> --mode approved|changes-requested|reviewed`
  - `cradle session await manual --reason "..."`
  - `cradle session await retry <await-id> [--resume-text "..."]`
- Wrapper 默认读取 `CRADLE_CHAT_SESSION_ID` 与 `CRADLE_WORKSPACE_ID`。
- Raw generated `await-create` 保留为 escape hatch。

Validation:

- `packages/cli/src/commands/session-await.test.ts` 覆盖 task-shaped create 和 retry route。

### P1: Terminal web rows could keep reading live-status cache

Await panel 旧行为会对 terminal rows 继续使用 live-status query/cache。一个已经 failed/triggered/cancelled 的记录可能展示 stale pending live status，降低可解释性。

Fix:

- `apps/web/src/features/session-await/await-panel.tsx` 只对 `status === "pending"` 的 GitHub await 调用 live status。
- 历史列表展示所有 non-pending awaits，不只展示 triggered/failed。
- Delivery failure 卡片显示 retry delivery action。

Validation:

- Web typecheck 可覆盖局部 TS regressions；当前全量 web typecheck 仍受无关文件阻塞。

### P1: Completion paths could deliver a blank resume message

`SessionAwaitSource` 旧类型允许 `matched: true` 时没有 `resumeText`。Poller 会把缺失值降级成空字符串并投递给 Chat Runtime，用户看到 session 被恢复但没有可理解的恢复原因。

Fix:

- `apps/server/src/modules/session-await/types.ts` 把 `CheckResult` 改成 discriminated union，`matched: true` 必须携带 `resumeText`。
- `apps/server/src/modules/session-await/poller.ts` 增加空白 resume text guard；违反 source contract 时标记 `failureKind: "source"`，不向 Chat Runtime 投递空消息。
- `apps/server/src/modules/session-await/service.ts` 拒绝 trigger 和 delivery retry 的空白 `resumeText`。
- `apps/server/src/modules/session-await/model.ts` 用 non-blank HTTP schema 表达同一约束。
- `pnpm generate:web` 后，`apps/web/src/api-gen/zod.gen.ts` 的 trigger/retry schema 同步包含 non-blank regex。
- `apps/server/src/modules/session-await/poller.ts` 暴露 `runOnce()`，用于显式执行 poller 单轮行为，不改变 HTTP API。

Validation:

- `apps/server/tests/session-await.test.ts` 覆盖直接 trigger 空白 resume message 被拒绝，以及 source adapter 返回空白 resume message 时不会 enqueue。

### P2: Timer and expiry checks used truthy timestamp checks

Poller 旧逻辑使用 `row.fireAt && row.fireAt <= now` / `row.expiresAt && row.expiresAt <= now`。这和 schema 的 nullable 语义不一致，`0` 这样的合法数值会被误认为未设置。

Fix:

- Poller 改为 `!== null` 判断。
- Server test 覆盖 `fireAt: 0` 被接受为合法 due timestamp。

Validation:

- `apps/server/tests/session-await.test.ts` 覆盖 zero-valued timer timestamp。

### P2: GitHub target input did not explain unsupported workflow run URLs

Web composer 支持 PR number、commit/ref、GitHub check-run URL，但用户常会粘贴 GitHub Actions workflow run URL。旧 UI 只是禁用 submit，没有说明为什么不可用。

Fix:

- `apps/web/src/features/session-await/await-github.ts` 增加 target input issue 描述函数。
- `apps/web/src/features/session-await/await-panel.tsx` 在 target 输入框下方显示具体错误，尤其说明 workflow run URL 不受支持。

Validation:

- `apps/web/src/features/session-await/await-github.test.ts` 覆盖 workflow run URL 和 review target 输入错误说明。

### P2: Available checks returned internal errors for missing GitHub repos

`GET /session-awaits/available-checks` 被 Settings 的 bypass rules UI 使用。旧实现直接透出底层 GitHub 404 exception，最终变成 `internal_server_error`，用户只能看到 Cradle 失败，无法判断是 repo 不存在、没有权限还是临时不可用。

Fix:

- `apps/server/src/modules/session-await/service.ts` 把 GitHub missing target 转成 `github_repo_not_found` / `github_repo_default_branch_not_found`。
- `apps/web/src/features/settings/await-settings.tsx` 显示 server error message，而不是固定的泛泛错误文案。

Validation:

- `apps/server/tests/session-await.test.ts` 覆盖 missing repo 返回 product error。
- 手动 route probe 确认 `/session-awaits/summary`、`/session-awaits/discovered-repos`、`/session-awaits/bypass-rules` 静态路由没有被 `/:id` shadow，且 `/session-awaits/available-checks?owner=acme&repo=missing` 返回 `404 github_repo_not_found`。

### P1: Raw GitHub CI filters could mix multiple target semantics

Task-shaped CLI 已经要求 `--pr`、`--sha`、`--run-id` 三选一，但 raw generated command 和 HTTP API 仍能提交同时包含多个目标的 `filterJson`。这会让 source resolver 同时解析 PR 和 check run，最终等待语义取决于内部覆盖顺序。

Fix:

- `apps/server/src/modules/session-await/sources/github-ci.ts` 把 CI filter schema 收紧为 exactly one target：`pr`、`sha` 或 `runs_id`。

Validation:

- `apps/server/tests/session-await-github.test.ts` 覆盖混合 `pr` 与 `runs_id` 时 schema 拒绝。

### P1: Bypass rules could hide required CI signals

Bypass Settings 文案说只用于 non-blocking CI checks，但 server source 层会对所有 check runs 套用 per-await 和 workspace-level bypass，required branch-protection contexts 也可能被 `*` 这类规则跳过。

Fix:

- `apps/server/src/modules/session-await/sources/github-ci.ts` 在过滤 bypass 前读取 branch protection required contexts，并保留 required check runs/statuses。
- `apps/web/src/features/settings/await-settings.tsx` 禁用 required check 的 bypass switch。
- `apps/server/src/modules/session-await/README.md` 明确 bypass 只适用于 non-required CI signals。

Validation:

- `apps/server/tests/session-await-github.test.ts` 覆盖 workspace `*` bypass 仍不会过滤 required check/status。

## Verification

已通过：

```bash
pnpm --filter @cradle/server exec vitest run tests/session-await.test.ts
pnpm --filter @cradle/server exec vitest run tests/session-await.test.ts tests/session-await-github.test.ts
pnpm --filter @cradle/server exec vitest run tests/session-await-github.test.ts
pnpm --filter @cradle/cli exec vitest run src/commands/session-await.test.ts
pnpm --filter @cradle/web exec vitest run src/features/session-await/await-github.test.ts
pnpm --filter @cradle/cli typecheck
pnpm --filter @cradle/cli exec tsc --noEmit --pretty false
pnpm --filter @cradle/server typecheck
pnpm gen:cli
pnpm generate:web
pnpm --filter @cradle/cli cradle session await --help
pnpm --filter @cradle/cli cradle session await retry --help
```

未通过但未指向本次 Session Await 改动：

- `pnpm --filter @cradle/web typecheck` 当前被 provider/profile generated API `unknown` 类型扩散、`src/features/system-agent/jarvis-popover.tsx` 的 `isBusy`/`canStop`、以及 `packages/streamdown/src/plugins/remark-incomplete.ts` 缺少 `mdast` 类型阻塞；输出未包含 `apps/web/src/features/session-await/await-panel.tsx`。

Notes:

- `pnpm gen:cli` 正常生成 `packages/cli/src/commands/generated/session/await-retry-delivery.ts`。
- 当前工作树已有无关 server/provider/profile 改动，generated `packages/cli/src/commands/generated/session/list.ts` 也随当前 OpenAPI 状态发生变化，未手工编辑 generated 文件。
