# provider-catalog

Provider live catalog HTTP API 与模型列表缓存。

本模块拥有 `/providers` route surface、provider-specific model listing、catalog cache、catalog audit writes，以及 provider list 结果的 capability defaults projection。Registry enrichment 仍由 `model-registry` 拥有，本模块只读取其 mapping/enrichment API。

## Files

- `index.ts`: `/providers` HTTP routes and generated CLI metadata for provider model list/cache/search/lookup.
- `model.ts`: Route-local TypeBox schemas for provider catalog requests and responses.
- `service.ts`: Provider target override resolution, live model listing, custom model fallback, registry enrichment, and audit writes.
- `catalog.ts`: Provider-specific metadata implementations for OpenAI-compatible and Anthropic model APIs.
- `model-cache.ts`: Provider model cache persistence helpers for profile and provider-target catalog rows.
- `model-capabilities.ts`: Provider-owned default capability projection for live and cached model descriptors.
- `model-capabilities.test.ts`: Focused coverage for default capability projection.
