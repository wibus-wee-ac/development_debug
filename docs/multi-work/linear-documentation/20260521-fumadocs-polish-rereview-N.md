# RereviewN: Fumadocs polish fixes final review

## Status

PASS

ReviewL 的阻塞项已经关闭。本轮复核只覆盖 ReviewL 与后续 ReviewM 定义的 PASS 条件，没有重新打开无关文档覆盖范围。

## Scope reviewed

- `documentations/source.config.ts`
- `documentations/lib/docs-graph.ts`
- `documentations/components/graph-view.tsx`
- `documentations/components/docs-link-graph.tsx`
- `documentations/components/docs-visuals.tsx`
- `documentations/components/mdx.tsx`
- `documentations/content/docs/map.mdx`
- `documentations/content/docs/developers/api/openapi.mdx`
- `documentations/package.json`
- `pnpm-lock.yaml`
- Review handoffs:
  - `docs/multi-work/linear-documentation/20260521-fumadocs-polish-review-ReviewL.md`
  - `docs/multi-work/linear-documentation/20260521-fumadocs-link-graph-review-M.md`
  - `docs/multi-work/linear-documentation/20260521-fumadocs-polish-fixes-FixM.md`

## Validation

Passed:

```bash
cd documentations && pnpm types:check
```

Passed:

```bash
cd documentations && pnpm build
```

`pnpm build` generated `/docs/map`, `/llms.txt`, `/llms-full.txt`, and `/llms.mdx/docs/map/content.md`. The only warning observed was the existing `metadataBase` warning, which is already documented as intentionally unresolved until there is an authoritative docs deployment origin.

## ReviewL blocker decisions

### PASS: `/docs/map` consumes Fumadocs extracted link references

Evidence:

- `documentations/source.config.ts` enables `extractLinkReferences: true`.
- `documentations/lib/docs-graph.ts:121-143` calls `source.getPages()` and reads `page.data.extractedReferences`.
- `documentations/lib/docs-graph.ts:86-102` resolves local references through `source.getPageByHref()` and `source.resolveHref()`.
- `documentations/lib/docs-graph.ts:150-183` converts resolved references into deduplicated internal links while tracking unresolved local references.
- `documentations/components/docs-link-graph.tsx:127-169` builds graph data with `buildDocsGraph()` and renders stats plus graph output.
- `documentations/content/docs/map.mdx:25-29` mounts `<DocsLinkGraph />` under `真实链接图谱`.

The static curated `<DocsKnowledgeGraph />` still exists, but it is now only the reader-path map. The actual link graph is derived from Fumadocs extracted references.

### PASS: Graph-like UI has a credible interactive render path

Evidence:

- `documentations/components/graph-view.tsx:32-34` lazy-loads `react-force-graph-2d`.
- `documentations/components/graph-view.tsx:73-97` measures the container with `ResizeObserver`.
- `documentations/components/graph-view.tsx:236-276` renders `ForceGraph2D` with graph data, d3 forces, node hover, node click routing, node drag, and zoom interaction.
- `documentations/package.json` adds `react-force-graph-2d`, `d3-force`, and `@types/d3-force`; `pnpm-lock.yaml` reflects those dependencies.

Official Fumadocs direct import is not required because the local installed package does not expose a direct Graph View export. This implementation satisfies the graph-like capability requirement with a real canvas force graph.

### PASS: Reader-facing copy is Simplified Chinese

Evidence:

- ReviewL's explicit English strings are no longer present: `Cradle docs graph`, `Start from a reader goal`, `Open full map`, `How to read the map`, `First decision`, `System boundary`, and `Next steps` do not appear in the reviewed visible-copy paths.
- `documentations/content/docs/map.mdx:10-37` uses Chinese headings and paragraphs: `如何阅读这张地图`, `第一选择`, `真实链接图谱`, `系统边界`, `下一步`.
- `documentations/components/docs-link-graph.tsx:140-151` uses Chinese graph title, description, and status copy.
- `documentations/components/graph-view.tsx:54-59` and `documentations/components/graph-view.tsx:288-290` use Chinese loading and tooltip metric copy.
- `documentations/components/docs-visuals.tsx` has converted the reader-facing titles/descriptions identified by ReviewL to Chinese, while retaining allowed technical identifiers such as `OpenAPI`, `CLI`, `runtime`, `provider`, `workspace`, and route names.

### PASS: OpenAPI page states the route-level API reference boundary

Evidence:

- `documentations/content/docs/developers/api/openapi.mdx:25-29` explicitly states that the page explains OpenAPI contract ownership, lifecycle, metadata, and validation, and is not a per-route API reference.
- The same section points route-level interactive reference to the server `/docs` Scalar UI and `/openapi.json`, and says a future Fumadocs route-level reference should be generated from the same `/openapi.json` rather than handwritten.

## Findings

No remaining ReviewL blockers found.

Residual non-blocking notes:

- The graph page now depends on `react-force-graph-2d` and canvas rendering. Build and type check pass, and FixM records production smoke evidence, but future dependency upgrades should keep an eye on SSR/client boundary behavior.
- Existing `metadataBase` warnings remain out of scope for this ReviewL rereview and should stay tied to the deployment-origin decision already recorded in the ExecPlan.

## Final verdict

PASS. The current working tree changes satisfy the ReviewL follow-up criteria for real Fumadocs link-reference consumption, interactive graph rendering path, Simplified Chinese visible documentation copy, and OpenAPI route-level reference boundary disclosure.
