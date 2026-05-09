<!--
Output: Kanban capability spec for server migration.
Input: Legacy kanban query/write flows and server-first ownership boundaries.
Position: apps/server/specs/capabilities kanban spec.
-->

# Capability: Kanban

## User / System Goal

- 系统需要提供 workspace-scoped 看板与 issue 基础管理。
- 第一阶段重点是 board 导航壳、默认状态列、issue 核心闭环、comment 核心闭环。
- session-link、relations、milestone/status 管理、issue-agent 投影先后置，避免跨 owner 写入重新污染边界。

## Current Behavior Evidence

- 旧 `KanbanService` 暴露 board/status/milestone/issue/comment/relation/session-link 的大而全 IPC 面。
- renderer 当前真实主路径主要依赖：`listBoards/createBoard/deleteBoard`、`listStatuses`、`listIssues/getIssue/createIssue/updateIssue/deleteIssue`、`listComments/addComment/deleteComment`。
- board detail 目前本质是 workspace-scoped issue 视图，而不是 board-specific query model。

## Target API (Slice 1)

- `GET /kanban/boards?workspaceId=`
- `POST /kanban/boards`
- `DELETE /kanban/boards/:id`
- `GET /kanban/statuses?workspaceId=`
- `GET /kanban/milestones?workspaceId=`
- `GET /kanban/issues?...`
- `GET /kanban/issues/:id`
- `POST /kanban/issues`
- `PATCH /kanban/issues/:id`
- `DELETE /kanban/issues/:id`
- `GET /kanban/issues/:id/comments`
- `POST /kanban/issues/:id/comments`
- `DELETE /kanban/comments/:id`

## Target Module Design

- `KanbanModule`
  - `KanbanController`: HTTP input validation
  - `KanbanService`: defaults seeding、owner 边界、业务规则
  - `KanbanStore`: DB-backed board/status/issue/comment queries and writes

## Test Plan

- 创建 board 时自动 seed 默认 statuses（`To Do` / `In Progress`）。
- issue 可创建、更新（含 `statusId` 变更）、删除。
- comments 可列出、添加、删除。
- 缺失 workspace/issue/board 与非法输入返回结构化错误。
