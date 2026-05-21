# Capability: Providers

## User / System Goal

- 系统需要暴露 provider metadata 能力：连通性 health check 与模型列表发现。
- 这些能力不能被强绑到“先有保存 profile”这一前提；请求应支持直接提交 provider config + secretRef。
- 若请求携带 `profileId`，server 可以附带写入 profile-linked runtime audit / capability snapshot；否则不应伪造归属。

## Current Behavior Evidence

- 旧 agent runtime 通过 profile id 做 health check / listModels，并顺手写 runtime audit。
- Claude / Codex / OpenAI-compatible 三类 provider 都有独立 metadata 发现逻辑。
- provider capability snapshot 仅在有真实 profile owner 时才有长期保留价值。

## Target API

- `POST /providers/health-check` → `{ providerKind, label, configJson, secretRef?, profileId? }`
- `POST /providers/models` → `{ providerKind, label, configJson, secretRef?, profileId? }`

## Target Module Design

- `ProvidersModule`
  - `ProvidersController`: body-based 请求校验
  - `ProvidersService`: provider 请求编排、health check、secret 读取、错误映射
  - `ProvidersStore`: runtime audit 写入；仅当 `profileId` 存在时记录 capability snapshot
  - `ProviderCatalog`: provider metadata registry
  - `provider-base.ts`: config parse、API key 解析、fallback model helper

## Test Plan

- openai-compatible / codex / claude-agent 三类 provider 都可通过 body-based 请求完成 health check / models。
- 缺失字段、非法 JSON、不可用 provider、模型接口失败都返回结构化错误。
- 无 `profileId` 的 ad-hoc 请求不会写 capability snapshot。
