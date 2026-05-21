<!--
Input: Alma snapshot preload evidence and Cradle workspace/git audit.
Output: Spec for workspace snapshots and rollback.
Position: docs/specs/alma-inspired/workspace-snapshots.md
-->

# Workspace Snapshots

## 目标

Cradle 需要提供 Git-independent workspace snapshots，用于 agent edits、temporary files、非 Git workspace 和高风险批量修改的恢复流程。Snapshot 是 Cradle-owned recovery point，不替代 Git。

## Alma 证据

Alma preload 暴露 `snapshot.create`、`snapshotFile`、`list`、`get`、`diff`、`rollback`、`rollbackFile` 和 `cleanup`。这些接口覆盖创建、查看、diff、回滚和清理完整链路。

## Cradle 当前状态

Cradle 有 Git status/diff 和 chat message snapshots。当前没有 workspace-owned snapshot/diff/rollback subsystem 能覆盖 arbitrary files，也没有和 agent risky operation 绑定的恢复点。

## Owner / Namespace

未来 `workspace-snapshots` 模块拥有 snapshot metadata、file copies、diff records 和 cleanup policy。`workspace` 拥有 path validation 和 root boundary。`git` 保持独立，不能成为 snapshot 前置条件。

## 目标行为

- 用户或 agent 可以在 risky operation 前创建 workspace snapshot。
- Snapshot 可以覆盖整个 workspace 或 selected files。
- 用户可以查看 snapshot diff，并 rollback all files 或 selected files。
- 回滚前检测当前文件是否已变更，并给出 conflict report。
- Cleanup policy 限制磁盘增长，但保留 protected snapshots。

## API 草案

- `POST /workspaces/:id/snapshots`
- `POST /workspaces/:id/snapshots/file`
- `GET /workspaces/:id/snapshots`
- `GET /workspaces/:id/snapshots/:snapshotId/diff`
- `POST /workspaces/:id/snapshots/:snapshotId/rollback`
- `POST /workspaces/:id/snapshots/cleanup`

## 数据模型

需要 `workspace_snapshots`、`workspace_snapshot_files` 和 cleanup audit records。Snapshot file storage 放在 Cradle workspace data 目录，不默认写入 source project。每个 file record 保存 path、content hash、size、mtime、capture status 和 optional ignore reason。

## 验收

- Rollback 能恢复 file bytes，并在文件自 snapshot 后变化时报告 conflict。
- Cleanup 不会删除 latest protected snapshot。
- Snapshot creation 遵守 ignored paths、size limits 和 workspace root boundary。
- 非 Git workspace 也能创建、diff 和 rollback snapshot。
