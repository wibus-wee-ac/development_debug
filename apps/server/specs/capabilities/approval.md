# Capability: Approval

## User / System Goal

- 系统需要提供一个 Cradle-owned approval registry，用来承载“等待用户确认”的产品级审批流。
- server-first 版本先完成 pending approval 的创建、查询、响应；不迁移 renderer push 或 ACP 专用桥接。
- 能力边界要显式：HTTP 负责 registry surface，内部仍保留 Promise-based wait primitive 供未来 ACP/tool runtime 调用。

## Current Behavior Evidence

- 旧 `approval-service.ts` 使用内存 `Map` 保存 pending approvals，并通过 Promise resolve 等待用户响应。
- 旧 IPC 只暴露 `listPending` 与 `respond`，因为 request 由内部 permission handler 发起。
- renderer approval hooks 依赖的数据模型只是 pending list + respond 语义。

## Target API (Slice 1)

- `GET /approvals`
- `POST /approvals`
- `POST /approvals/:approvalId/respond`

## Target Module Design

- `ApprovalModule`
  - `ApprovalController`: HTTP query/create/respond endpoints
  - `ApprovalService`: registry owner，提供 `createPending`、`requestApproval`、`respond`、`listPending`
- 所有 pending approvals 只保存在内存中；这是等待态工作流状态，不做磁盘落盘。
- 第一阶段不做 renderer push / SSE / ACP permission handler 接线，但保留 listener 与 Promise wait primitive。

## Test Plan

- 可通过 HTTP 创建 approval，并通过列表接口按 `chatSessionId` 过滤查看。
- respond 后 approval 会从 pending 列表移除。
- 非法 payload、未知 approvalId、无效 optionId 返回结构化错误。