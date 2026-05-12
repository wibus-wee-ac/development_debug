<!--
Output: Inventory for OpenAPI document generation and HTTP exposure.
Input: AppModule metadata plus Zod-backed DTO classes from server controllers.
Position: apps/server/src/openapi infrastructure guide.
-->

# openapi

- `openapi-routes.ts` — builds a cached `@cradle/openapi` document from `AppModule` metadata, exposes `/openapi.json` plus `/docs/openapi.json`, and mounts a Scalar UI at `/docs`.
