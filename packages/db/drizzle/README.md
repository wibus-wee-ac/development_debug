<!-- Once this directory changes, update this README.md -->

# Drizzle

这里存放 SQLite 的 Drizzle migration 产物，是运行时真正执行的 schema 历史。
SQL 文件负责重放数据库结构，`meta/` 负责 journal 与 snapshot，三者必须成套维护。
当前历史已在首次个人/公开使用前重新基线化。后续一旦有外部或长期本地数据需要保留，就只能追加 migration，不要重写历史。

## Files

- **0000_initial_release_baseline.sql**: 当前 schema 的干净 baseline migration。
- **meta/**: Drizzle journal 与 schema snapshot，用于 tooling 和 migration 顺序管理；该目录必须保持 JSON-only，否则 `drizzle-kit generate` 会解析失败

## Regenerate Before Release Boundary

如果还没有任何需要保留的用户数据，可以删除 `*.sql` 和 `meta/` 后重新生成 baseline。
一旦 release 边界成立，就不要再做这件事；所有 schema 变化都必须追加新的 migration。
