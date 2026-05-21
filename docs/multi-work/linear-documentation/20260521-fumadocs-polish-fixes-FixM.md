# FixM: Fumadocs polish and link graph fixes

## Status

PASS-ready

## Scope

This pass addresses ReviewL and the follow-up link-graph review:

- `/docs/map` must consume Fumadocs link references instead of only rendering static path cards.
- Visual documentation components must use Simplified Chinese for reader-facing copy.
- The OpenAPI page must state its route-level reference boundary.
- The graph page must pass build, production smoke, and mobile/desktop canvas checks.

## Changes

### Real Fumadocs link graph

- Added `documentations/lib/docs-graph.ts`.
- It reads `source.getPages()`.
- It reads each page's `page.data.extractedReferences`.
- It resolves local references through `source.getPageByHref()` and `source.resolveHref()`.
- It produces nodes, links, inbound/outbound counts, weak pages, and unresolved reference diagnostics.

Current production `/docs/map` metrics:

- Pages: `71`
- Internal links: `150`
- Extracted references: `162`
- Unresolved local references: `0`

### Graph view UI

- Added `documentations/components/graph-view.tsx`.
- The component follows the Fumadocs CLI Graph View pattern with `react-force-graph-2d` and `d3-force`.
- Canvas size is driven by the documentation card container via `ResizeObserver`, so it does not expand to the full viewport.
- Desktop production smoke: canvas `802 x 544`, non-empty pixels.
- Mobile production smoke: canvas `324 x 480`, non-empty pixels.

### MDX integration

- Added `documentations/components/docs-link-graph.tsx`.
- Registered it from `documentations/components/mdx.tsx`.
- Updated `documentations/content/docs/map.mdx` to include `<DocsLinkGraph />`.
- Kept `<DocsKnowledgeGraph />` as the curated reader-path map, while `<DocsLinkGraph />` is the actual Fumadocs extracted-reference graph.

### Reader-facing copy

- Converted visible copy in `documentations/components/docs-visuals.tsx`, `documentations/components/docs-link-graph.tsx`, and `documentations/content/docs/map.mdx` to Simplified Chinese.
- Technical identifiers remain English where they are product/API names, for example `OpenAPI`, `CLI`, `provider`, `runtime`, `workspace`, `x-cradle-cli`.

### OpenAPI boundary

- Updated `documentations/content/docs/developers/api/openapi.mdx`.
- It now states that the page explains OpenAPI contract ownership and lifecycle, not route-level API reference.
- It points route-level interactive reference to server `/docs` Scalar UI and `/openapi.json`.
- It explicitly says future Fumadocs route-level reference should be generated from the same `/openapi.json`, not handwritten.

### Dependencies

- Added `react-force-graph-2d`.
- Added `d3-force`.
- Added `@types/d3-force`.

## Validation

Commands run successfully:

```bash
cd documentations && pnpm types:check
cd documentations && pnpm build
```

Build warning:

- Next still warns about missing `metadataBase`.
- This remains accepted because the project has no authoritative docs deployment origin; a previous review rejected setting it to the GitHub repository URL.

Production server smoke:

```bash
cd documentations && pnpm exec next start -p 3211
```

Checked pages:

- `/docs`
- `/docs/map`
- `/docs/developers/overview`
- `/docs/agents/overview`
- `/docs/chronicle/overview`
- `/docs/integrations/slack-bridge`
- `/docs/troubleshooting`

All checked production pages returned no browser page errors.

Screenshots:

- `/tmp/cradle-docs-map-prod-desktop.png`
- `/tmp/cradle-docs-map-prod-mobile.png`
- `/tmp/cradle-docs-home-prod.png`
- `/tmp/cradle-docs-developers-prod.png`
- `/tmp/cradle-docs-agents-prod-mobile.png`
- `/tmp/cradle-docs-chronicle-prod-mobile.png`
- `/tmp/cradle-docs-slack-prod.png`
- `/tmp/cradle-docs-troubleshooting-prod-mobile.png`

Charset checks:

- `/llms.txt`: `text/plain; charset=utf-8`
- `/llms.mdx/docs/integrations/slack-bridge/content.md`: `text/markdown; charset=utf-8`

## Notes

The dev server on `3210` had stale browser error history from a temporary concurrent `fumadocs-mdx` generation race that left `.source/server.ts` empty. Running `pnpm exec fumadocs-mdx` regenerated the file, and sequential `types:check` and `build` passed. Final smoke checks were run against clean production server `3211` to avoid stale HMR overlay history.
