# Yansu-Style Chronicle Rust Microphone Diagnostics Fix

## Scope

本 handoff 修复 `20260521-rust-microphone-diagnostics-ReviewY.md` 里指出的 microphone diagnostics artifact overwrite 问题，并补齐本 slice 的 Drizzle 验证记录。

这个 fix 不改变数据库 schema，不新增 Drizzle migration，也不把 microphone diagnostics 接入 transcript 或 memory generation。

## Review Finding Addressed

`ReviewY` 的 blocking finding 是 artifact identity 不安全：原实现只用秒级 timestamp 生成：

```text
<timestamp>-microphone-diagnostic.wav
<timestamp>-microphone-diagnostic.json
```

由于 `Timestamp::filesystem()` 只精确到秒，重复或并发运行 `cradle-chronicle --audio-diagnostics` 可能覆盖同一秒内的诊断产物。

## Fix

`chronicle/src/audio/wav.rs` 现在使用 collision-resistant artifact reservation：

```text
<timestamp>-<pid>-<sequence>-microphone-diagnostic.wav
<timestamp>-<pid>-<sequence>-microphone-diagnostic.json
```

WAV 和 metadata 都通过 exclusive creation 写入：

```text
OpenOptions::create_new(true)
```

如果 WAV 创建成功但 metadata 路径发生 collision，代码会删除刚创建的 WAV，并尝试下一个 sequence。这样不会留下半个成功的 artifact pair。

## Files Changed

- `chronicle/src/audio/wav.rs`
  - adds unique artifact suffixes using process id and sequence.
  - reserves WAV and metadata paths with exclusive creation.
  - adds a same-second repeated-write regression test.
- `chronicle/src/README.md`
  - updates `main.rs` ownership wording.
  - documents the new artifact path shape.
- `docs/multi-work/yansu-style-chronicle/20260521-rust-microphone-diagnostics-SynthesisX.md`
  - updates artifact paths, test coverage, Rust test count, and Drizzle validation note.
- `docs/exec-plans/20260521-03-yansu-style-chronicle.md`
  - records the fix, corrected artifact paths, and `drizzle-kit generate` clean result.

## Drizzle Status

This fix does not touch `packages/db/src/schema/chronicle.ts`.

The current Chronicle DB tables are already represented in Drizzle schema and generated migration artifacts:

- `packages/db/drizzle/0025_lowly_stature.sql`
- `packages/db/drizzle/0026_perfect_korath.sql`
- `packages/db/drizzle/0027_dazzling_vance_astro.sql`

Validation command:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
```

Observed result:

```text
No schema changes, nothing to migrate
```

## Validation

Passed after the fix:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
cargo fmt --manifest-path chronicle/Cargo.toml
cargo test --manifest-path chronicle/Cargo.toml
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
```

Rust result:

- 54 unit tests passed.
- 1 smoke test passed.
- clippy passed with warnings denied.

## Remaining Limitations

- This is still diagnostics-only microphone capture.
- No background audio capture is wired into the daemon.
- No system audio capture is implemented.
- No VAD, ASR, speaker embedding, speaker labeling, or transcript generation runtime is implemented.
- Real microphone capture still depends on host microphone permission and available input hardware.

## Re-review Request

The re-review should focus on:

- whether same-second repeated diagnostics can still overwrite artifact files;
- whether partially-created artifact pairs can be left behind after metadata path collision;
- whether docs now match the implementation;
- whether the Drizzle workflow is correctly documented for this Rust-only slice.
