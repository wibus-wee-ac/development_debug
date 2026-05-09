<!--
Output: Profiles capability spec for server migration.
Input: Saved runtime profile lifecycle and session cleanup semantics.
Position: apps/server/specs/capabilities profiles spec.
-->

# Capability: Profiles

## User / System Goal

- 系统需要提供保存型 runtime profile 的 CRUD。
- profile 是用户可选的运行时配置单元，负责承载 `providerKind`、`configJson`、`credentialRef`。
- 删除 profile 时，server 必须同时清理其拥有的 session 与 profile 相关审计数据。

## Current Behavior Evidence

- 旧 agent runtime 暴露 profile CRUD，并以 `agent_profiles` 为配置持久化载体。
- session 与 runtime 审计数据通过 `agentProfileId` 关联 profile。
- 用户在设置页、新建聊天、issue agent 等流程里都依赖稳定的 profile id。

## Target API

- `GET /profiles` → 列出全部 profile
- `GET /profiles/:id` → 获取单个 profile
- `PUT /profiles/:id` → 创建或更新 profile
- `DELETE /profiles/:id` → 删除 profile，并清理其 session / 审计从属数据

## Target Module Design

- `ProfilesModule`
  - `ProfilesController`: HTTP 参数校验与错误边界
  - `ProfilesService`: profile 生命周期与 session cleanup 编排
  - `ProfilesStore`: `agent_profiles` 持久化与 profile-owned cascade delete

## Test Plan

- CRUD 返回结构稳定。
- 删除 profile 后，其 session 与 runtime 审计数据一并清理。
- 缺失字段、非法 provider kind 返回结构化错误。
