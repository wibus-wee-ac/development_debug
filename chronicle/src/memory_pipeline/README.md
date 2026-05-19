# Chronicle Memory Pipeline

记忆生成目录，负责把已持久化的 frame artifact 转换为 Chronicle memory Markdown。

## Files

- `mod.rs`: memory pipeline module exports。
- `naming.rs`: 为 `10min`、`6h` 与 custom windows 生成 Chronicle memory filename。
- `prompt.rs`: 带 anti-prompt-injection guardrails 的 prompt construction。
- `recursive.rs`: two-phase recursive summary orchestration。
- `summarizer.rs`: summary writer trait 与 local deterministic writer。
