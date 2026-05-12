<!--
Output: Elysia HTTP infrastructure inventory.
Input: Request-id, error mapping, OpenAPI plugin setup, and runtime-context bridging.
Position: apps/server/src/http
-->

# HTTP

Cross-cutting Elysia HTTP infrastructure for the new explicit server composition path.

## Files

- **request-id.ts**: request-id hook for the Elysia skeleton and shared header constant.
- **error-mapping.ts**: AppError-to-HTTP JSON mapping for the Elysia skeleton.
- **openapi.ts**: Elysia OpenAPI plugin setup and compatibility path constants for `/openapi.json` and `/docs`.
- **validation.ts**: shared TypeBox/Elysia validation normalization plus explicit route-profile matching for feature-owned error semantics.
- **server-services.ts**: runtime services plugin that decorates typed singleton services onto Elysia context for feature modules.