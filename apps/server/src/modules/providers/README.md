# providers

`providers.controller.ts` accepts schema-typed `config` objects at the HTTP boundary and only serializes to `configJson` when crossing into legacy internal request shapes.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

- `providers.module.ts` — wires provider-owned HTTP endpoints and services.
- `providers.controller.ts` — exposes body-based `/providers/models` endpoints with Zod-inferred typed config payloads.
- `providers.service.ts` — resolves provider metadata requests, reads secrets, and maps provider errors.
- `provider-catalog.ts` — registers provider metadata implementations by kind, including provider-specific auth and default base URL handling.
- `model-capabilities.ts` — projects provider-owned default model capability metadata, including Anthropic text+image input defaults used by Composer attachment gating.
- `provider-base.ts` — shared Zod-backed config parsing and API-key helpers, including Claude Agent SDK-owned alias configuration from effective runtime `config.claudeAgent`.
- `runtime-compatibility.ts` — runtime-kind to provider-kind compatibility rules shared by Session creation and Chat Runtime profile overrides.
- `model-info-registry.ts` — best-effort `models.dev` enrichment plus exact/fuzzy/manual/alias/unmatched status projection; global mappings are applied before models.dev fallback.
- `types.ts` — shared provider taxonomy and metadata response types.
