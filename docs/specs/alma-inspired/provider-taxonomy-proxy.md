# Provider Taxonomy 与 Proxy

## 目标

Cradle 应在确有 provider-specific auth、默认 URL、model listing、pricing、capability metadata 需求时扩展 first-class provider，同时保留 OpenAI-compatible 作为长尾 provider 的通用入口。

## Alma 证据

Alma 支持 OpenAI、Anthropic、Google、DeepSeek、Azure、OpenRouter、AIHubMix、Moonshot、Kimi、Ollama、Volcengine、Z.ai、Cloudflare AI Gateway、custom providers、Copilot、Claude Subscription，并提供 OpenAI Responses 与 Anthropic Messages proxy route。

## Cradle 当前状态

Cradle provider taxonomy 更窄，主要是 OpenAI-compatible、Anthropic 与 runtime-specific providers。已有 `models.dev` enrichment，但很多 Alma first-class providers 还没有独立 provider kind。

## Owner / Namespace

`apps/server/src/modules/providers` 拥有 provider taxonomy、model listing、health checks、pricing metadata、默认 config schema。`profiles` 拥有 saved profile instances。`secrets` 拥有 credentials。

## 目标行为

- 只有当 provider 需要 custom auth、endpoint shape、model listing、pricing 或 safety metadata 时才升格为 first-class。
- 其余 provider 继续走 OpenAI-compatible。
- provider proxy route 必须显式、可审计、受权限控制。

## API 草案

- `GET /providers/catalog`
- `POST /providers/models`
- `POST /providers/health-check`
- `POST /providers/:profileId/proxy/responses`

## 验收

- 增加 DeepSeek 或 Google 不需要在 chat UI 内写分支条件。
- Provider health/model fetch failure 返回结构化错误。
- Proxy route 不把 raw secrets 暴露给 renderer。
