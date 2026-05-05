<!-- Once this directory changes, update this README.md -->

# Drizzle/Meta

这里存放 Drizzle migration 的 journal 与 snapshot，不是可随手丢弃的缓存。
`_journal.json` 定义 migration 清单和顺序，`*_snapshot.json` 提供 drizzle-kit diff 的历史基线。
如果 SQL、journal、snapshot 任何一个缺席，就应该视为 migration 历史已损坏。

## Files

- **_journal.json**: 当前 migration 链的顺序与 tag 清单
- **0000_snapshot.json**: `0000_initial_baseline.sql` 对应的 schema snapshot
