# Yansu-Style Chronicle Audio Transcript Contract Re-review

## 结论

Pass.

本轮 re-review 对照了 `20260521-audio-transcript-contract-ReviewN.md` 的四个原始 findings、`20260521-audio-transcript-contract-FixO.md` 的修复说明，以及当前相关 git diff。四个 finding 均已解决，当前没有剩余阻断项。

## 原始 Findings 复核

### 1. Transcript ingest silently accepts invalid chronology and rewrites it to "now"

状态：Resolved.

证据：

- `apps/server/src/modules/chronicle/service.ts:1099-1108` 现在通过 `readRequiredAudioTimestamp()` 解析 `startedAt` / `endedAt`，并在 `endedAt < startedAt` 时抛出 400 `AppError`。
- `apps/server/src/modules/chronicle/service.ts:2494-2504` 对无效 transcript timestamp 返回 `chronicle_audio_transcript_timestamp_invalid`。
- `apps/server/src/modules/chronicle/service.ts:2506-2516` 对 `segment.endMs < segment.startMs` 返回 `chronicle_audio_transcript_segment_range_invalid`。
- `apps/server/tests/chronicle.test.ts:458-506` 覆盖 invalid `startedAt`、invalid `endedAt`、reversed transcript time range、reversed segment range，均断言 400。

备注：`parseTimestamp()` 仍是共享宽松解析函数，但 audio transcript ingest 已改为通过 `readRequiredAudioTimestamp()` 调用，不再对无效 evidence timestamp fallback 到 server receipt time。

### 2. Migration handoff is incomplete relative to the actual journal/schema chain

状态：Resolved.

证据：

- `docs/multi-work/yansu-style-chronicle/20260521-audio-transcript-contract-SynthesisM.md:22-32` 仍明确列出本 slice 的 audio transcript migration artifact 是 `0027_dazzling_vance_astro`。
- `docs/multi-work/yansu-style-chronicle/20260521-audio-transcript-contract-SynthesisM.md:34-41` 现在明确说明该 slice 不能脱离同 branch 中的 `0025_lowly_stature` 与 `0026_perfect_korath` 独立落地，并解释这些迁移提供 `chronicle_memories.content_hash`、chunk、keyword、lexical embedding tables。
- `packages/db/drizzle/meta/_journal.json:180-199` 的 journal chain 与 handoff 的修订说明一致。

### 3. Rust transport types do not encode the server contract enums or confidence bounds

状态：Resolved.

证据：

- `chronicle/src/cradle_client.rs:88-105` 新增 `ChronicleAudioTranscriptSource` 与 `ChronicleAudioTranscriptStatus` typed enums，替代 loose `String`。
- `chronicle/src/cradle_client.rs:107-122` 新增 `ChronicleTranscriptConfidence::new()`，将 confidence 限制在 `[0, 1]`，`NaN` 也会被拒绝。
- `chronicle/src/cradle_client.rs:140-153` transcript report 现在使用 typed enum 和 bounded confidence。
- `chronicle/src/cradle_client.rs:156-182` 新增 local `validate()`，检查空 `source_id`、空 `started_at`、空 segment text、reversed segment range。
- `chronicle/src/cradle_client.rs:300-312` `record_audio_transcript()` 在 POST 前调用 `validate()`。
- `chronicle/src/cradle_client.rs:483-493` 覆盖 enum serialization 和 invalid confidence。
- `chronicle/src/cradle_client.rs:496-523` 覆盖 reversed segment local validation。

### 4. Tests prove the happy path but not idempotent rebuild semantics

状态：Resolved.

证据：

- `apps/server/tests/chronicle.test.ts:350-399` 保留首次 transcript ingest happy path。
- `apps/server/tests/chronicle.test.ts:401-439` 使用相同 `sourceId` 再次 POST，断言 transcript id 不变、memory id 不变、segment count 更新为 1、旧 `AudioTargetAlpha` 不再出现在 transcript preview/segments。
- `apps/server/tests/chronicle.test.ts:441-456` 进一步断言 list/search 使用更新后的 `AudioTargetBeta`，且 stale transcript text 不再从 memory search 返回。
- `apps/server/tests/chronicle.test.ts:583-587` timeline 断言使用更新后的 audio transcript preview。

## Ownership 复核

Pass.

当前修复没有引入跨 namespace 写入。audio transcript evidence、derived memory、memory index、model resource 状态仍在 Chronicle-owned `chronicle_*` schema 与 Cradle/Chronicle data roots 内。迁移边界文档也已经说明 audio contract slice 与 memory-index migrations 的依赖关系。

## 验证说明

我本轮没有重新执行测试命令；本次 re-review 基于 `FixO` 声明和当前 diff 逐项核对。`FixO` 声明已通过：

- `cargo fmt --manifest-path chronicle/Cargo.toml`
- `cargo test --manifest-path chronicle/Cargo.toml`
- `pnpm --filter @cradle/server exec tsc --noEmit`
- `pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts`

建议合入前仍按 `FixO` 的 final focused validation 重新跑一遍 drizzle generate、web eslint、cargo clippy 与 diff check。
