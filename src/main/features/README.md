<!-- Once this directory changes, update this README.md -->

# Main/Features

`features/` 目录承载 owner-owned 业务语义、查询/命令用例与领域编排器。
每个子目录都应回答“谁拥有这段行为，它会跟谁一起演化”。
不要把 feature 语义重新塞回 `app/` glue 或 `platform/` 适配层。

## Files

- **agent-runtime/**: provider catalog、凭证与 runtime provider 合约
- **chat/**: 聊天会话编排、provider 抽象与 thread search
- **issue-agent/**: issue delegation、runner 与 agent session/activity 查询
- **kanban/**: Kanban 查询与写侧命令
- **skills/**: filesystem-first skills inventory 与 source 抓取
- **workflow-rules/**: workflow rules 的读写与持久化规则
