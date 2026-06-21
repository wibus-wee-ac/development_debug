# Add Cradle Assets for Issue Images

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not currently include a root `PLANS.md` file. This plan follows the ExecPlan rules read from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`: the plan must be self-contained, must guide a novice through a working implementation, must keep progress and decisions current, and must define concrete validation steps.

## Purpose / Big Picture

Cradle Issues need to accept pasted or selected images inside descriptions and comments. After this change, a user can paste a screenshot into an Issue description or comment, Cradle stores the compressed image under its own data directory, the Markdown contains a stable `cradle-asset://...` reference, and every Issue view renders that image without depending on a temporary browser data URL or an absolute local server port.

The important architectural boundary is that `assets` owns file bytes and image compression, while `issue` owns Issue text and activity semantics. Issue Markdown may reference an asset id, but Issue should not store file bytes, image derivatives, or compression policy. This keeps the asset namespace reusable for future Cradle surfaces without writing into Chat, Chronicle, or workspace repository namespaces.

## Progress

- [x] (2026-06-21 00:11 CST) Read the `execplan` skill and its `PLANS.md` reference.
- [x] (2026-06-21 00:11 CST) Confirmed there are no existing `20260621-*.md` ExecPlans, so this plan uses order `01`.
- [x] (2026-06-21 00:11 CST) Captured the design decision to create a generic `assets` module rather than an `issue_assets` module.
- [x] (2026-06-21 00:23 CST) Added the minimal `assets` database table schema and generated `packages/db/drizzle/0008_condemned_the_fury.sql`.
- [x] (2026-06-21 00:23 CST) Added the server `assets` module with data-directory storage, `sharp` image processing, metadata reads, content reads, and deletion.
- [x] (2026-06-21 00:23 CST) Registered the `assets` module in `apps/server/src/app.ts` and exposed upload, metadata, content, and delete HTTP routes.
- [x] (2026-06-21 00:38 CST) Added handwritten frontend asset helpers in `apps/web/src/features/assets` because multipart upload does not need generated SDK support for this milestone.
- [x] (2026-06-21 00:38 CST) Added a Tiptap asset image extension and taught `MarkdownEditor` to upload selected, pasted, or dropped JPEG/PNG/WebP images through a generic `assetImages.upload(file)` prop.
- [x] (2026-06-21 00:38 CST) Integrated Issue descriptions, Issue comments, and Issue peek rendering with `cradle-asset://...` display through `/assets/:id/content`.
- [x] (2026-06-21 00:43 CST) Ran focused validation: `pnpm --filter @cradle/web typecheck` passed and `pnpm --filter @cradle/server typecheck` passed.
- [x] (2026-06-21 00:53 CST) Exercised the HTTP routes through the Elysia app with a real generated PNG, a real workspace, repo migrations, and a temporary data directory; verified asset metadata, disk file path, content headers, and byte length.
- [x] (2026-06-21 00:53 CST) Exercised the Issue API data path by creating an Issue description and comment containing the uploaded asset's `cradle-asset://...` Markdown URL and reading both back through `GET /issues/:id` and `GET /issues/:id/activity`.
- [x] (2026-06-21 00:53 CST) Re-ran `pnpm --filter @cradle/db generate`; Drizzle reported "No schema changes, nothing to migrate".
- [x] (2026-06-21 00:58 CST) Ran the existing web Vitest suite under `apps/web/src` after the editor/comment changes; 47 test files and 188 tests passed.
- [x] (2026-06-21 00:58 CST) Ran a no-file jsdom/static render check for `AssetMarkdown`; it rendered `cradle-asset://asset-jsdom-1` to `http://127.0.0.1:21423/assets/asset-jsdom-1/content` while preserving `data-cradle-asset-src="cradle-asset://asset-jsdom-1"`.

## Surprises & Discoveries

- Observation: The repository root did not expose a conventional `node_modules/elysia` path when this plan was written.
  Evidence: `rg` against `node_modules/elysia` returned "No such file or directory".
  Impact: The implementation must verify the multipart route shape through TypeScript and OpenAPI generation instead of assuming a local dependency source path is available for inspection.

- Observation: Tiptap already has an Image extension in `apps/web/src/components/editor/markdown-editor.tsx`, but a canonical `cradle-asset://...` URL would not load directly in a browser `img` tag.
  Evidence: Browsers do not fetch custom URL schemes as HTTP resources. The current editor passes image `src` through to DOM rendering.
  Impact: The frontend needs explicit mapping in both static Markdown rendering and editor image rendering.

- Observation: An earlier server typecheck run was blocked by an unrelated existing error in `apps/server/src/modules/chat-runtime-providers/codex/turn/event-to-chunk-mapper.ts`, but the blocker was gone by the final validation run.
  Evidence: The earlier run reported `TS2322: Type 'string | null | undefined' is not assignable to type 'string'`; the later `pnpm --filter @cradle/server typecheck` run completed with only the `NO_COLOR` warning.
  Impact: Final validation can treat the assets server code as typechecked in the current worktree.

- Observation: `react-markdown` strips custom URL schemes such as `cradle-asset://` unless the renderer provides a custom URL transform.
  Evidence: Its default safe protocol list only includes `http`, `https`, `irc`, `ircs`, `mailto`, and `xmpp`.
  Impact: `@cradle/streamdown` now exposes a `urlTransform` prop on `StaticRender`, and `AssetMarkdown` only adds `cradle-asset://` to the default safe behavior.

- Observation: `@cradle/streamdown` has no package-level `typecheck` script.
  Evidence: `pnpm --filter @cradle/streamdown typecheck` returned `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`.
  Impact: The streamdown type change is covered indirectly by `pnpm --filter @cradle/web typecheck`, because the web app imports the workspace package source.

- Observation: The shell environment used for this validation inherited `CRADLE_MIGRATIONS_DIR=/Applications/Cradle.app/Contents/Resources/drizzle`, which pointed at an installed app bundle that did not contain the new `0008_condemned_the_fury` migration.
  Evidence: An isolated runtime upload first failed with `SqliteError: no such table: assets`; inspecting `getServerConfig().migrationsDir` in that run showed `/Applications/Cradle.app/Contents/Resources/drizzle`. Re-running with `CRADLE_MIGRATIONS_DIR=/Users/wibus/dev/Cradle/packages/db/drizzle` created the `assets` table and the upload passed.
  Impact: Validation scripts that need current repo migrations must override inherited desktop environment variables. The generated repo migration itself is valid.

- Observation: Direct `tsx --eval` execution does not use the same Vite automatic JSX runtime assumptions as the web app.
  Evidence: A no-file static render check for `AssetMarkdown` initially failed in `packages/streamdown/src/static-render.tsx` with `ReferenceError: React is not defined`. Adding an explicit `import * as React from 'react'` made the static render path work while `pnpm --filter @cradle/web typecheck` still passed.
  Impact: `StaticRender` is now friendlier to direct server/static rendering without changing the browser build behavior.

## Decision Log

- Decision: Create a generic `assets` server module and database table, not `issue_assets`.
  Rationale: The file byte lifecycle is not Issue-specific. Issue should reference assets in Markdown, while the `assets` namespace owns storage, compression, content serving, and deletion semantics.
  Date/Author: 2026-06-21 / Codex

- Decision: Keep the database design to one `assets` table.
  Rationale: The current requirement is images for Issues. A separate variant table is unnecessary until Cradle needs multiple durable renditions per asset. The stored row describes the final file Cradle serves.
  Date/Author: 2026-06-21 / Codex

- Decision: Store the actual file on disk under the Cradle data directory and store only a relative `storage_path` in SQLite.
  Rationale: SQLite should hold durable metadata, not binary image payloads or absolute machine-specific paths. A relative path keeps the data directory movable.
  Date/Author: 2026-06-21 / Codex

- Decision: Store canonical Markdown references as `cradle-asset://{assetId}`.
  Rationale: Absolute HTTP URLs include a local port and break when the server endpoint changes. Relative HTTP URLs break in Vite/Electron contexts where the web origin and API origin differ. A Cradle-owned scheme is stable and can be resolved by the renderer.
  Date/Author: 2026-06-21 / Codex

- Decision: Compress images with server-side `sharp` and strip metadata.
  Rationale: `@cradle/server` already depends on `sharp`. Server-side compression gives one policy for Web, Desktop, and future API callers, and stripping metadata avoids preserving device or location metadata from screenshots.
  Date/Author: 2026-06-21 / Codex

- Decision: When WebP is larger than a same-format fallback, store the same-format fallback after re-encoding it with `sharp`, not the raw upload bytes.
  Rationale: Raw upload bytes may preserve EXIF metadata. Re-encoding keeps the one-table design and size fallback while still stripping metadata and applying orientation and max-size policy.
  Date/Author: 2026-06-21 / Codex

- Decision: Use a handwritten web `fetch` helper for multipart asset uploads instead of regenerating and consuming the OpenAPI SDK.
  Rationale: The upload route is intentionally HTTP-only and multipart file upload is awkward for generated CLI/API helpers. The web helper is small, typed with zod, and keeps the generated SDK untouched.
  Date/Author: 2026-06-21 / Codex

- Decision: Extend `@cradle/streamdown`'s `StaticRender` API with `react-markdown`'s native `Components` and `UrlTransform` types.
  Rationale: This avoids local `unknown` casts in the assets renderer and uses the existing markdown library API directly. It also lets the assets wrapper preserve `cradle-asset://` while retaining the default URL safety policy for other links.
  Date/Author: 2026-06-21 / Codex

## Outcomes & Retrospective

The database schema, migration, server assets module, and frontend Issue image integration are implemented in the current worktree. Users can upload Issue description images through the shared Markdown editor, upload Issue comment images through paste or the image button, and render stored asset references in Issue comments and peek descriptions. Focused TypeScript validation for `@cradle/server` and `@cradle/web` passes.

Runtime validation now proves the server behavior end to end with a real generated PNG, a temporary Cradle data directory, repo migrations, and a real workspace row. The upload wrote a file under `assets/workspaces/{workspaceId}/...`, returned `markdownUrl: "cradle-asset://..."`, and served bytes with matching `content-type`, `content-length`, `x-content-type-options: nosniff`, and `cache-control: private, max-age=31536000, immutable`. A second runtime validation created an Issue and comment containing the uploaded asset's Markdown URL and read them back unchanged through the Issue APIs. Browser UI exercise was not run because the repository instructions say not to use Browser testing unless requested; the corresponding UI code paths are implemented and typechecked.

Frontend validation includes the existing Vitest suite for `apps/web/src`, which passed after the editor and activity timeline changes, and a no-file static render check proving that `AssetMarkdown` resolves `cradle-asset://...` to the server content route while keeping the canonical URL in a `data-cradle-asset-src` attribute.

## Context and Orientation

The Issue feature is owned by `apps/server/src/modules/issue`. Its existing route module is `apps/server/src/modules/issue/index.ts`, its schemas are in `apps/server/src/modules/issue/model.ts`, and its business logic is in `apps/server/src/modules/issue/service.ts`. Issue rows and comments are defined in `packages/db/src/schema/issue.ts`. Currently Issue descriptions and comments are plain Markdown-like text fields: `issues.description` and `issue_comments.content`.

The web Issue editor uses `apps/web/src/components/editor/markdown-editor.tsx`. That editor serializes content through `tiptap-markdown`. Tiptap is the rich text editor library used here; it stores an editable document in the browser and can serialize that document back to Markdown. For asset images, the editor uses `apps/web/src/components/editor/asset-image-extension.ts`, which keeps the saved node `src` as `cradle-asset://...` while rendering the browser DOM `src` as a server content URL. The comment timeline renders Markdown with `AssetMarkdown` from `apps/web/src/features/assets/asset-markdown.tsx`.

The new `assets` feature should be a sibling server module, not a submodule of Issue. Create `apps/server/src/modules/assets`. It should own a new database schema file, server routes, and storage functions. Register the module in `apps/server/src/app.ts` so the routes are part of the server contract app and the OpenAPI document.

The Cradle data directory is the server-owned filesystem root for local product data. Server code can resolve it through `getServerConfig()` from `apps/server/src/infra`. When `config.dataDir` exists, use it. When it does not exist, use `dirname(config.dbPath)` as the base, matching existing modules such as preferences and workflow rules. The assets module must write only under this base directory.

The term `storage_path` means a data-directory-relative file path, for example `assets/workspaces/workspace_123/550e8400-e29b-41d4-a716-446655440000.webp`. It must not be an absolute path.

## Plan of Work

First, add a small reusable database schema under `packages/db/src/schema/assets.ts`. Export it from `packages/db/src/schema/index.ts` and from the package's public schema barrel. The table should be named `assets` and should contain only metadata for the final stored file:

    id: text primary key
    workspace_id: nullable text foreign key to workspaces.id, cascade on delete
    filename: text not null
    media_type: text not null
    byte_size: integer not null
    width: nullable integer
    height: nullable integer
    sha256: text not null
    storage_path: text not null
    created_at: integer not null

Add indexes for workspace lookup and hash lookup. Use names that match the local schema style, such as `assets_workspace_id_idx` and `assets_sha256_idx`. Do not add owner-specific columns, issue-specific link tables, variant tables, or JSON projection columns for this first implementation.

Second, add a server module at `apps/server/src/modules/assets`. The module should follow the same package shape as other modules: `index.ts` for routes, `model.ts` for TypeBox schemas, `service.ts` for behavior, and `README.md` for ownership notes. The `README.md` must say that this module owns Cradle asset file storage and compression, while feature modules such as Issue may only reference asset ids.

In `service.ts`, implement functions with stable names:

    export async function createAsset(input: CreateAssetInput): Promise<AssetView>
    export function getAsset(id: string): AssetView
    export function getAssetContent(id: string): AssetContent
    export async function deleteAsset(id: string): Promise<void>
    export function assetContentRoute(id: string): string

`CreateAssetInput` should include `workspaceId?: string | null`, `file: File`, and no Issue-specific fields. `AssetView` should mirror the database row plus a `url` field set to `/assets/{id}/content` and a `markdownUrl` field set to `cradle-asset://{id}`. `AssetContent` should include an absolute filesystem path, `mediaType`, `byteSize`, and any headers needed by the route.

For image processing, accept `image/jpeg`, `image/png`, and `image/webp` first. Reject SVG in the first implementation because SVG can contain script-like or remote-loading content and should be treated separately later. Use `sharp(buffer, { failOn: 'error' }).rotate().metadata()` to read the image and fix EXIF orientation. Use a max dimension of `2048` pixels for the largest side. For output, use WebP at quality `86`. If the processed WebP is larger than a same-format fallback, store the same-format fallback after re-encoding it through `sharp`, not the raw uploaded bytes. This fallback keeps metadata stripped while avoiding wasteful WebP expansion. Compute `sha256` over the final bytes that are written to disk, not over the upload bytes.

Write files under:

    assets/workspaces/{workspaceId}/{assetId}.{extension}

when `workspaceId` is present, and under:

    assets/global/{assetId}.{extension}

when it is not present. Use `mkdir(..., { recursive: true })`, write with an exclusive flag so the implementation does not overwrite an existing file, and store the relative path in `assets.storage_path`. If the database insert fails after writing the file, delete the just-written file before rethrowing. If deletion later finds the file already missing, still delete the database row.

Third, expose HTTP routes in `apps/server/src/modules/assets/index.ts` with prefix `/assets`:

    POST /assets
    GET /assets/:id
    GET /assets/:id/content
    DELETE /assets/:id

`POST /assets` should accept multipart form data with `file` and optional `workspaceId`. Prefer Elysia's file body schema if TypeScript accepts it in this repository, for example a body object with `file: t.File(...)` and `workspaceId: t.Optional(t.String())`. If OpenAPI generation or TypeScript rejects that shape, use `request.formData()` inside the handler, keep the response schemas precise, and document the multipart body in the route description and module README. Do not add `x-cradle-cli` to `POST /assets`, because multipart file upload is not a stable generated CLI command. It is acceptable to expose `GET /assets/:id` and `DELETE /assets/:id` to CLI later, but this first implementation does not need CLI exposure.

The content route should return a `Response` with the stored file. Set at least these headers:

    content-type: asset.mediaType
    content-length: asset.byteSize
    x-content-type-options: nosniff
    cache-control: private, max-age=31536000, immutable

Range requests are not required for the image-only first implementation. Video and audio can be planned later, and that is when `Range` support becomes mandatory.

Fourth, update generated API clients only where needed. If `POST /assets` generates a usable helper in `apps/web/src/api-gen/sdk.gen.ts`, use it. If multipart generation is awkward, use a small handwritten helper in `apps/web/src/features/assets/assets-api.ts` that uses `fetch` with `FormData` and `getServerUrl()` from `apps/web/src/lib/electron.ts`. The helper should return a typed object parsed with `zod`, not `unknown` plus inline type guards.

Fifth, add frontend asset helpers under `apps/web/src/features/assets`:

    asset-url.ts
    asset-markdown.tsx
    use-upload-asset.ts

`asset-url.ts` should provide:

    export function isCradleAssetUrl(value: string | null | undefined): boolean
    export function readAssetIdFromUrl(value: string): string | null
    export function toAssetMarkdownUrl(id: string): string
    export function toAssetContentUrl(id: string): string

`toAssetContentUrl` should build an absolute URL with `new URL('/assets/{id}/content', getServerUrl()).toString()`. This ensures images load in Vite dev, Electron, and hosted web contexts where the API origin is not the same as the web origin.

`asset-markdown.tsx` should export an `AssetMarkdown` component that wraps `StaticRender` and overrides Markdown `img` and `a` rendering. When an image `src` is `cradle-asset://{id}`, render an `img` with `src={toAssetContentUrl(id)}` and preserve useful attributes like `alt`, `loading="lazy"`, and a restrained class. When an anchor `href` is `cradle-asset://{id}`, render an ordinary link to the content URL for now. Do not enable raw HTML rendering.

Sixth, modify `apps/web/src/components/editor/markdown-editor.tsx` to support asset image uploads without hard-coding Issue semantics. Add an optional prop such as:

    assetImages?: {
      upload: (file: File) => Promise<{ id: string; filename: string; markdownUrl: string }>
    }

When `assetImages` is provided and the editor is not read-only, handle pasted and dropped image files. Upload each file through `assetImages.upload`, then insert an image node with `src` set to the returned `markdownUrl` and `alt` set to the filename. Also provide a small image insert button near the editor surface or bubble menu if that matches the existing UI style. Use static Tailwind classes and `cn()` for conditional class composition.

Because a browser cannot load `cradle-asset://...` directly, replace the plain Tiptap Image extension with a local extension that renders canonical asset URLs as HTTP content URLs in the DOM but preserves canonical Markdown. One acceptable shape is to create `apps/web/src/components/editor/asset-image-extension.ts` that extends Tiptap Image. The extension should keep the node attribute `src` as `cradle-asset://{id}` and customize `renderHTML` so the emitted DOM `src` becomes `toAssetContentUrl(id)` and also includes `data-cradle-asset-src="cradle-asset://{id}"`. Its `parseHTML` should read `data-cradle-asset-src` back when present. This keeps saved Markdown stable while the editor still shows the image.

Seventh, integrate assets into Issue UI. In `apps/web/src/features/kanban/issue-detail/issue-description.tsx`, pass an upload function to `MarkdownEditor` using the issue's `workspaceId`. On upload success, the editor inserts image Markdown using `cradle-asset://...`. In `apps/web/src/features/kanban/issue-detail/activity-timeline.tsx`, replace direct `StaticRender` for user comments with the new `AssetMarkdown` component. Add image upload to the comment input in a minimal way: a hidden file input and an icon button that uploads the selected image, then appends `![filename](cradle-asset://id)` to the textarea. Also handle pasted image files in the textarea.

The Create Issue dialog can remain text-only for this milestone. Images require an existing Issue-linked workspace context and durable saved asset reference; supporting draft assets before Issue creation should be a separate design.

## Concrete Steps

Start from the repository root:

    cd /Users/wibus/dev/Cradle

Create and export the database schema:

    edit packages/db/src/schema/assets.ts
    edit packages/db/src/schema/index.ts
    edit packages/db/src/schema/README.md

Generate the migration:

    pnpm --filter @cradle/db generate

Expected result: Drizzle creates a new SQL migration under `packages/db/drizzle/` and updates `packages/db/drizzle/meta/`. Inspect the migration and confirm it creates only the `assets` table and the intended indexes.

Create the server module:

    mkdir -p apps/server/src/modules/assets
    edit apps/server/src/modules/assets/model.ts
    edit apps/server/src/modules/assets/service.ts
    edit apps/server/src/modules/assets/index.ts
    edit apps/server/src/modules/assets/README.md
    edit apps/server/src/app.ts

When editing, use the existing module style from `apps/server/src/modules/issue` as the local pattern. Keep route handlers thin and put file validation, `sharp` processing, filesystem writes, database inserts, and cleanup in `service.ts`.

Run server validation:

    pnpm --filter @cradle/server typecheck

Observed result on 2026-06-21 00:38 CST: TypeScript completed without errors. The route uses `request.formData()` because it keeps the multipart upload contract simple and avoids generated CLI assumptions.

Add web helpers and Issue integration:

    mkdir -p apps/web/src/features/assets
    edit apps/web/src/features/assets/assets-api.ts
    edit apps/web/src/features/assets/asset-url.ts
    edit apps/web/src/features/assets/asset-markdown.tsx
    edit apps/web/src/features/assets/use-upload-asset.ts
    edit apps/web/src/components/editor/asset-image-extension.ts
    edit apps/web/src/components/editor/markdown-editor.tsx
    edit apps/web/src/features/kanban/issue-detail/issue-description.tsx
    edit apps/web/src/features/kanban/issue-detail/activity-timeline.tsx
    edit apps/web/src/features/kanban/issue-peek-panel.tsx
    edit packages/streamdown/src/static-render.tsx
    edit packages/streamdown/src/index.ts

If route changes affect generated web SDK types, run:

    pnpm --filter @cradle/web generate

Then run:

    pnpm --filter @cradle/web typecheck

Observed result on 2026-06-21 00:43 CST: TypeScript completed without errors. Frontend component tests were not added for this ordinary frontend change, matching the repository instruction.

Run existing web tests after the editor and comment timeline changes:

    pnpm --filter @cradle/web test -- src/components/editor/markdown-editor.test.tsx src/features/kanban/issue-detail/activity-timeline.test.tsx

Observed result on 2026-06-21 00:56 CST: the command executed the existing `apps/web/src` Vitest suite and passed 47 test files / 188 tests.

Re-running migration generation:

    pnpm --filter @cradle/db generate

Observed result on 2026-06-21 00:53 CST: Drizzle reported `No schema changes, nothing to migrate`, with the `assets` table visible in its schema summary.

Manually exercise the HTTP route after starting the server:

    pnpm --filter @cradle/server dev

In another shell, use a small PNG or JPEG:

    curl -sS -F "workspaceId=<workspace-id>" -F "file=@/path/to/screenshot.png" http://127.0.0.1:21423/assets

Expected response shape:

    {
      "id": "...",
      "workspaceId": "...",
      "filename": "screenshot.png",
      "mediaType": "image/webp",
      "byteSize": 12345,
      "width": 1600,
      "height": 900,
      "sha256": "...",
      "storagePath": "assets/workspaces/.../....webp",
      "url": "/assets/.../content",
      "markdownUrl": "cradle-asset://..."
    }

Fetch the content:

    curl -I http://127.0.0.1:21423/assets/<asset-id>/content

Expected headers include:

    content-type: image/webp
    x-content-type-options: nosniff

Observed result on 2026-06-21 00:53 CST: An isolated runtime script called `createServerContractApp({ includeRuntimeHttpPlugins: true })` with a temporary `CRADLE_DATA_DIR` and repo `CRADLE_MIGRATIONS_DIR`, created a workspace, uploaded a generated PNG to `POST /assets`, read `GET /assets/:id/content`, and verified:

    {
      "ok": true,
      "storagePath": "assets/workspaces/d290e6b8-105d-46ca-88e6-cef3761a2e40/7db0d4c6-e4bc-47f3-b3c9-fafedfddf8db.webp",
      "mediaType": "image/webp",
      "byteSize": 84,
      "markdownUrl": "cradle-asset://7db0d4c6-e4bc-47f3-b3c9-fafedfddf8db",
      "contentHeaders": {
        "contentType": "image/webp",
        "contentLength": "84",
        "xContentTypeOptions": "nosniff",
        "cacheControl": "private, max-age=31536000, immutable"
      }
    }

The runtime script also checked the physical file with `stat(resolve(dataDir, asset.storagePath))`, confirmed the file size matched the row, confirmed the served byte length matched the row, and cleaned up the temporary data directory.

Finally, use the app UI when browser verification is allowed. Open an Issue detail page, paste an image into the description, save, reload, and confirm the image still displays. Add a comment with a pasted image and confirm the timeline displays it. Inspect the saved Markdown through the Issue API and confirm it contains `cradle-asset://...`, not a `data:` URL and not an absolute `http://127.0.0.1:...` URL. Browser UI exercise was not run during this implementation because the repository instructions explicitly discourage Browser testing unless requested.

The Issue API portion was still exercised without a browser on 2026-06-21 00:53 CST. A second isolated runtime script uploaded an asset, created an Issue with description Markdown containing the asset URL, added a comment with the same image Markdown, then verified `GET /issues/:id` and `GET /issues/:id/activity` preserved `cradle-asset://...` and did not contain `data:` or local `http://127.0.0.1` / `http://localhost` asset URLs:

    {
      "ok": true,
      "issueId": "ASS-001",
      "markdownUrl": "cradle-asset://b89724bc-8044-45f9-bf84-f176f6ce5294",
      "descriptionContainsCradleAsset": true,
      "commentActivityContainsCradleAsset": true
    }

A no-file static render check for `AssetMarkdown` on 2026-06-21 00:58 CST produced:

    {
      "ok": true,
      "html": "<div data-pre-mounted=\"\"><p><img src=\"http://127.0.0.1:21423/assets/asset-jsdom-1/content\" alt=\"proof\" loading=\"lazy\" decoding=\"async\" data-cradle-asset-src=\"cradle-asset://asset-jsdom-1\" class=\"my-2 max-h-[420px] max-w-full rounded-md border border-border object-contain\"/></p></div>"
    }

## Validation and Acceptance

The change is accepted when these behaviors are true:

After uploading a PNG or JPEG to `POST /assets`, the server writes one real file under the Cradle data directory in an `assets/...` subdirectory, inserts one row in the `assets` table, and returns a metadata response with a `markdownUrl` beginning with `cradle-asset://`.

After fetching `GET /assets/:id/content`, the server returns image bytes with the recorded `mediaType`, a matching `content-length`, and `x-content-type-options: nosniff`.

After pasting an image into an Issue description, the editor shows the image immediately, saving and reloading preserves it, and `GET /issues/:id` returns a `description` containing `cradle-asset://...`.

After pasting or selecting an image in an Issue comment, the comment timeline renders the image and `GET /issues/:id/activity` returns comment content containing `cradle-asset://...`.

Run these commands and expect success:

    pnpm --filter @cradle/server typecheck
    pnpm --filter @cradle/web typecheck

If the API client was regenerated, also confirm:

    pnpm --filter @cradle/web generate

finishes and produces deterministic generated files.

## Idempotence and Recovery

The database migration should be additive. Re-running `pnpm --filter @cradle/db generate` without schema changes should not create a second migration. If it does, stop and inspect whether the schema snapshot is out of sync before continuing.

The asset upload service should use a generated UUID for each asset id, so retrying an upload creates a separate asset rather than overwriting a file. File writes should use exclusive creation. If a file is written but the database insert fails, the service must delete that file before throwing.

Deleting an asset should be safe if the file is already missing. The service should still delete the database row and should not throw solely because the filesystem path is absent.

If frontend upload succeeds but saving Issue Markdown fails, the uploaded asset may be temporarily unreferenced. This is acceptable for the first implementation. Do not add a garbage collector in this milestone; document the possibility in the module README if it remains relevant after implementation.

If the multipart route shape causes OpenAPI generation problems, keep the route HTTP-only and handwritten on the web side. Do not add generated CLI upload support as a workaround.

## Artifacts and Notes

Current relevant files:

    packages/db/src/schema/issue.ts
    apps/server/src/modules/issue/index.ts
    apps/server/src/modules/issue/model.ts
    apps/server/src/modules/issue/service.ts
    apps/web/src/components/editor/markdown-editor.tsx
    apps/web/src/features/kanban/issue-detail/issue-description.tsx
    apps/web/src/features/kanban/issue-detail/activity-timeline.tsx
    apps/web/src/features/kanban/issue-peek-panel.tsx
    packages/streamdown/src/static-render.tsx
    packages/streamdown/src/index.ts

New files expected by this plan:

    packages/db/src/schema/assets.ts
    apps/server/src/modules/assets/index.ts
    apps/server/src/modules/assets/model.ts
    apps/server/src/modules/assets/service.ts
    apps/server/src/modules/assets/README.md
    apps/web/src/features/assets/assets-api.ts
    apps/web/src/features/assets/asset-url.ts
    apps/web/src/features/assets/asset-markdown.tsx
    apps/web/src/features/assets/use-upload-asset.ts
    apps/web/src/components/editor/asset-image-extension.ts

The database schema should stay close to this shape:

    export const assets = sqliteTable('assets', {
      id: textPk(),
      workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
      filename: text('filename').notNull(),
      mediaType: text('media_type').notNull(),
      byteSize: int('byte_size').notNull(),
      width: int('width'),
      height: int('height'),
      sha256: text('sha256').notNull(),
      storagePath: text('storage_path').notNull(),
      ...createdAt(),
    }, table => ({
      byWorkspace: index('assets_workspace_id_idx').on(table.workspaceId),
      bySha256: index('assets_sha256_idx').on(table.sha256),
    }))

Avoid adding these in the first implementation:

- `issue_assets` link table
- `asset_variants` table
- raw image bytes in SQLite
- absolute filesystem paths in SQLite
- browser `data:` URLs in Issue Markdown
- raw HTML rendering for video or audio
- SVG inline rendering

## Interfaces and Dependencies

Use `sharp` from `@cradle/server` dependencies for image processing. The service should import it directly:

    import sharp from 'sharp'

Use Node standard library modules for hashing and filesystem access:

    import { createHash, randomUUID } from 'node:crypto'
    import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
    import { dirname, isAbsolute, relative, resolve } from 'node:path'

Use Drizzle for all database access. Do not use raw SQL for ordinary CRUD. The assets table belongs in `packages/db/src/schema/assets.ts` and should be imported by `apps/server/src/modules/assets/service.ts` from `@cradle/db`.

The server module should export an Elysia app named `assets`:

    export const assets = new Elysia({
      prefix: '/assets',
      detail: { tags: ['assets'] },
    })

Register it in `apps/server/src/app.ts` next to other product modules:

    import { assets } from './modules/assets'
    ...
    app.use(assets)

The frontend URL helper interface should be:

    export function isCradleAssetUrl(value: string | null | undefined): boolean
    export function readAssetIdFromUrl(value: string): string | null
    export function toAssetMarkdownUrl(id: string): string
    export function toAssetContentUrl(id: string): string

The Markdown editor upload prop should be generic and should not mention Issue:

    assetImages?: {
      upload: (file: File) => Promise<{
        id: string
        filename: string
        markdownUrl: string
      }>
    }

Issue integration should provide that prop from `issue-description.tsx` using `issue.workspaceId`, and comment integration should use the same upload hook from `activity-timeline.tsx`.

Revision note 2026-06-21 00:11 CST: Initial ExecPlan created after deciding that Cradle should have a generic assets module with filesystem-backed image storage, server-side sharp compression, and Issue Markdown references through `cradle-asset://...`.

Revision note 2026-06-21 00:23 CST: Recorded completion of the database and server module milestones, the generated migration name, the unrelated server typecheck blocker, and the decision to use a re-encoded same-format fallback instead of raw uploaded bytes.

Revision note 2026-06-21 00:43 CST: Recorded completion of the frontend Issue integration, streamdown URL transform support, focused typecheck results, and the remaining manual runtime validation gap.

Revision note 2026-06-21 00:53 CST: Recorded successful isolated runtime validation for asset upload/content serving, Issue description/comment persistence, DB migration idempotence, and the inherited `CRADLE_MIGRATIONS_DIR` caveat.

Revision note 2026-06-21 00:58 CST: Recorded frontend validation evidence from the existing web Vitest suite, the AssetMarkdown static render check, and the `StaticRender` explicit React import needed for direct static rendering.
