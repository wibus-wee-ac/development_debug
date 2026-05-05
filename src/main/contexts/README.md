<!-- Once this directory changes, update this README.md -->

# src/main/contexts

主进程按 bounded context 组织的业务代码放在这里。
每个上下文自己拥有 application / infrastructure 等子层，而不是把业务逻辑扔回横向技术目录。
新增复杂后端能力时，先确定 owner，再落到对应 context。

## Files

- **kanban/**: Kanban 上下文，负责 issue/status/board/milestone 相关应用层能力
- **issue-agent/**: Issue Agent 上下文，负责委派、agent session 与执行 runner
