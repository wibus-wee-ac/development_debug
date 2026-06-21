# Assets Module

Cradle-owned reusable asset storage. This module owns local file bytes, image validation, image compression, metadata rows, content serving, and asset deletion. Feature modules such as Issue may reference assets by ID or by `cradle-asset://{id}` Markdown URLs, but they do not own compression policy or file lifecycle.

Files are stored under the server data directory in the `assets/` namespace. The database stores only metadata and a data-directory-relative `storagePath`; it must not store absolute paths or binary payloads.

## Files

- `index.ts`: Elysia `/assets` routes for multipart image upload, metadata reads, content reads, and deletion. Upload is intentionally HTTP-only and is not exposed as a generated CLI command.
- `model.ts`: TypeBox response schemas for asset metadata and delete acknowledgements.
- `service.ts`: Asset validation, workspace guard, `sharp` image processing, filesystem writes under the Cradle data directory, Drizzle persistence, content path resolution, and deletion cleanup.

## Current Scope

The first implementation supports JPEG, PNG, and WebP image uploads. Server-side processing rotates according to image metadata, resizes the largest side to at most 2048 pixels, strips metadata through re-encoding, writes either WebP or a same-format fallback, and records the final stored file.

SVG, audio, video, thumbnails, garbage collection for unreferenced assets, and Range requests are intentionally out of scope for this first image milestone.
