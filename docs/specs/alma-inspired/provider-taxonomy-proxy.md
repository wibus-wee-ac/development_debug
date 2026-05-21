<!--
Input: Alma provider evidence and Cradle provider module audit.
Output: Spec for provider taxonomy and proxy expansion.
Position: docs/specs/alma-inspired/provider-taxonomy-proxy.md
-->

# Provider Taxonomy And Proxy

## Goal

Cradle should expand provider management where provider-specific auth, default URLs, models, pricing, or capability metadata justify first-class support, while keeping generic OpenAI-compatible profiles for long-tail providers.

## Alma Evidence

Alma includes OpenAI, Anthropic, Google, DeepSeek, Azure, OpenRouter, AIHubMix, Moonshot, Kimi, Ollama, Volcengine, Z.ai, Cloudflare AI Gateway, custom providers, Copilot, and Claude Subscription. It also exposes local provider proxy routes for OpenAI Responses and Anthropic Messages.

## Cradle Current State

Cradle provider taxonomy is narrower, centered on OpenAI-compatible and Anthropic profiles plus runtime-specific providers. Models.dev enrichment exists, but many Alma first-class providers are not separate provider kinds.

## Target Ownership

`apps/server/src/modules/providers` owns provider taxonomy, model listing, health checks, pricing metadata, and default config schemas. `profiles` owns saved profile instances. `secrets` owns credentials.

## Target Behavior

- Promote providers to first-class only when they need custom auth, endpoint shape, model listing, pricing, or safety metadata.
- Preserve OpenAI-compatible for providers that require only `baseUrl` and API key.
- Optional provider proxy routes must be explicit and access-controlled.

## API Sketch

- `GET /providers/catalog`
- `POST /providers/models`
- `POST /providers/health-check`
- Optional `POST /providers/:profileId/proxy/responses`

## Acceptance

- Adding DeepSeek or Google does not require changing chat UI conditionals outside provider metadata.
- Provider health and model fetch failures return structured errors.
- Proxy routes never expose raw secrets to renderer code.
