<!--
Output: Inventory for Cradle-owned OpenAPI document generation package.
Input: Tsuki controller/module metadata from `@tsuki-hono/common` plus Zod DTO schemas.
Position: packages/openapi package index.
-->

# @cradle/openapi

Cradle 自有的 OpenAPI 3.1 文档生成包。
这份实现当前直接 vendor 自 `tsuki-hono` 的 `openapi` package，目的是把修复节奏收回到本仓库，而不是继续依赖上游发版。
当前额外支持通过 `ApiDoc({ responses: ... })` 为 handler 显式声明响应 schema，并把这些 metadata 降成 OpenAPI `responses`.

## Structure

- **src/index.ts**: OpenAPI document builder, `ApiDoc.responses` metadata support, and Zod-to-JSON-Schema lowering logic.
- **package.json**: Workspace manifest for `@cradle/openapi`.
- **tsconfig.json**: TypeScript config for the workspace package.
