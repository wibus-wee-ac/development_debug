<!-- Once this directory changes, update this README.md -->

# Main/Features/Workflow Rules

Workflow Rules feature 负责 workflow rule 的读取、保存、删除与列表语义。
它为 app/ipc 提供稳定的业务边界，而不把规则持久化逻辑散落到 adapter。
把 workflow rule 的数据约束与 owner 语义集中在这里。

## Files

- **workflow-rules.ts**: workflow rule 的持久化访问与变更逻辑
