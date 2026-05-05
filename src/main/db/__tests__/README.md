<!-- Once this directory changes, update this README.md -->

# Main/DB/__tests__

数据库测试验证 schema 约束与持久化层的结构性不变量。
它们服务于持久化边界，而不是 feature 行为本身。
修改 schema 或迁移假设时，应先在这里补防线。

## Files

- **agent-runtime-schema.test.ts**: 验证 agent-runtime 相关表结构与约束
