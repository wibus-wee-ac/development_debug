# Chronicle Slack Background Sync Synthesis

Date: 2026-05-20
Agent: SynthesisH
Scope: Main-agent implementation of the Slack background synchronization slice.

## Context

目标仍然是按 `docs/draft-solutions/yansu-chronicle-spec.md` 把 Chronicle 做成可直接体验的 Cradle-owned 活动记忆系统。此前 Slack 已有 Server-first 手动 `conversations.history` sync，但用户体验仍然需要手动点击同步，不符合消息源“配置后持续感知”的行为。

本轮尝试继续使用 `$multi-work` review 节点，但当前会话已有多个子 agent，新的 explorer spawn 返回 agent thread limit reached。因此本轮由主线程完成实现、测试和文档记录，没有新增并行 reviewer。

## Implemented Behavior

Slack source 现在具备 Server-owned 后台生命周期：

- `createServerApp({ startBackgroundTasks: true })` 会启动 Chronicle Slack background sync。
- background sync 启动时会立即执行一次 tick。
- 后续每 60 秒同步所有 enabled Slack sources。
- 每个 source 有 per-source in-flight guard，避免手动 sync 和后台 tick 重入同一个 source。
- 全局 tick 有 running guard，避免 interval overlap。
- 手动 endpoint `POST /chronicle/message-sources/:sourceId/sync` 保留，作为立即拉取和排查入口。
- 后台同步遇到缺 token 或缺 channel 的 source 时，更新 source 状态和 Chronicle event，不抛异常中断整轮 tick。

## Files Changed

- `apps/server/src/modules/chronicle/service.ts`
  - Added Slack background sync lifecycle functions.
  - Added `runSlackSyncTick()` for deterministic tests and internal scheduling.
  - Added in-flight guards and unified Slack sync failure recording.

- `apps/server/src/app.ts`
  - Starts Slack background sync with other background tasks.
  - Stops Slack background sync before daemon cleanup and infra shutdown.

- `apps/server/tests/chronicle.test.ts`
  - Proves background tick imports a configured Slack source.
  - Keeps manual sync endpoint coverage as idempotent follow-up.

- `apps/server/src/modules/chronicle/README.md`
  - Updated Slack behavior from manual-only sync to background polling plus manual immediate sync.

- `docs/exec-plans/20260521-03-yansu-style-chronicle.md`
  - Recorded progress, decision, validation, and remaining limitations.

## Validation

Passed:

- `pnpm exec drizzle-kit generate --config drizzle.config.ts`
  - Result: no schema changes, nothing to migrate.
- `pnpm --filter @cradle/server exec tsc --noEmit`
- `pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts`

## Remaining Risks

Slack is still polling-based, not Socket Mode. This is enough to remove the manual-sync-only blocker and uses the existing Chronicle DB/API contract, but it does not provide low-latency event delivery, reconnect semantics, or Slack rate-limit backoff beyond one sync attempt per interval.

The full Chronicle goal remains incomplete. Remaining major gaps include local model manifest/download/checksum lifecycle, audio VAD/ASR/speaker pipeline, embedding engine, semantic dedup/search, and richer accessibility tree capture.
