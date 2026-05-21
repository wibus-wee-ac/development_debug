<!--
Input: Alma workspace renderer evidence and Cradle workspace/git/pty audit.
Output: Spec for workspace file, Git, terminal, and preview coverage.
Position: docs/specs/alma-inspired/workspace-files-git-terminal-preview.md
-->

# Workspace Files、Git、Terminal 与 Preview

## 目标

Cradle 应继续强化 workspace-first coding environment，同时补齐 preview server 和非文本文件审阅相关缺口。

## Alma 证据

Alma renderer 暴露 workspace file tree、file content reading、binary previews、terminal sessions over WebSocket、preview server start/stop、workspace WebSocket refresh、Git operations、GitHub PR、CI logs。

## Cradle 当前状态

Cradle 已有 workspace CRUD、file tree、Git status/branch/graph/fetch、Pack Codebase、PTY WebSocket terminal sessions、TUI、workspace detail editing。但 preview server 和广义 binary preview 还不等价。

## Owner / Namespace

`workspace` 拥有安全文件列表和文本读写。`git` 拥有 Git 操作。`pty` 拥有 terminal process。未来 preview owner 拥有 preview server lifecycle。文件预览归 `file-preview`。

## 目标行为

- Workspace file operations 保持 path-safe 与 owner-scoped。
- Terminal sessions 继续 session/workspace scoped，并可 replay。
- Preview servers 通过 server-owned lifecycle 启动、停止、查看状态。
- Binary preview 委托给 file preview owner。

## API 草案

- 继续复用现有 workspace、git、terminal APIs。
- `POST /workspaces/:id/previews`
- `GET /workspaces/:id/previews`

## 验收

- 启动 preview server 会记录 workspace、command、port、status、logs。
- Server shutdown 会清理 terminal resources。
- File preview 不绕过 workspace path validation。
