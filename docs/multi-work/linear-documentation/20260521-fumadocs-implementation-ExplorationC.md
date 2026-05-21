# Fumadocs implementation handoff

## Scope

本 handoff 研究 `documentations/` 当前 Fumadocs 骨架如何承载 Cradle 文档站。研究入口以 Fumadocs 官方 `llms.txt` 为主，并只跟进实现所需页面：page conventions、MDX、search 和 LLM text routes。

本文件不实现文档正文，不修改 `documentations/content/docs/`。

## External sources

- `https://www.fumadocs.dev/llms.txt`
- `https://www.fumadocs.dev/docs/page-conventions`
- `https://www.fumadocs.dev/docs/mdx/next`
- `https://www.fumadocs.dev/docs/markdown`
- `https://www.fumadocs.dev/docs/search/orama`
- `https://www.fumadocs.dev/docs/integrations/llms`

## Current local state

- [documentations/source.config.ts](/Users/wibus/dev/Cradle/documentations/source.config.ts:6) defines a single `docs` collection rooted at `content/docs`.
- [documentations/source.config.ts](/Users/wibus/dev/Cradle/documentations/source.config.ts:10) enables `includeProcessedMarkdown`, which is required by the current `/llms-full.txt` implementation.
- [documentations/lib/source.ts](/Users/wibus/dev/Cradle/documentations/lib/source.ts:7) loads the collection through `loader()` with `baseUrl: docsRoute`.
- [documentations/lib/source.ts](/Users/wibus/dev/Cradle/documentations/lib/source.ts:10) enables `lucideIconsPlugin()`, so `meta.json` icon names should be Lucide icon names.
- [documentations/app/docs/[[...slug]]/page.tsx](/Users/wibus/dev/Cradle/documentations/app/docs/[[...slug]]/page.tsx:18) resolves pages with `source.getPage(params.slug)`.
- [documentations/app/docs/layout.tsx](/Users/wibus/dev/Cradle/documentations/app/docs/layout.tsx:7) passes `source.getPageTree()` into `DocsLayout`.
- [documentations/app/api/search/route.ts](/Users/wibus/dev/Cradle/documentations/app/api/search/route.ts:4) creates an Orama search route from the same source, currently with `language: 'english'`.
- [documentations/app/llms.txt/route.ts](/Users/wibus/dev/Cradle/documentations/app/llms.txt/route.ts:7) serves the Fumadocs LLM index with `llms(source).index()`.
- [documentations/app/llms-full.txt/route.ts](/Users/wibus/dev/Cradle/documentations/app/llms-full.txt/route.ts:6) concatenates every page through `getLLMText()`.
- [documentations/app/llms.mdx/docs/[[...slug]]/route.ts](/Users/wibus/dev/Cradle/documentations/app/llms.mdx/docs/[[...slug]]/route.ts:8) serves per-page processed Markdown for copy and content negotiation.
- [documentations/proxy.ts](/Users/wibus/dev/Cradle/documentations/proxy.ts:5) rewrites `Accept: text/markdown` and `.md` URLs to per-page Markdown routes.
- [documentations/package.json](/Users/wibus/dev/Cradle/documentations/package.json:5) exposes `build`, `dev`, `start`, and `types:check`.

## Recommended content tree

Use `documentations/content/docs/` as the single documentation source. Keep the tree shallow enough for sidebar scanning, but split the major audiences into folders with `meta.json`.

Recommended first pass:

```text
content/docs/
  index.mdx
  getting-started.mdx
  concepts.mdx
  workspace/
    meta.json
    overview.mdx
    desktop-app.mdx
    web-workspace.mdx
    approvals.mdx
    git-and-workspaces.mdx
  agents/
    meta.json
    overview.mdx
    chat-runtime.mdx
    providers-and-models.mdx
    skills.mdx
    plugins.mdx
    browser-automation.mdx
  workflows/
    meta.json
    kanban.mdx
    issue-agents.mdx
    automation.mdx
    session-await.mdx
  chronicle/
    meta.json
    overview.mdx
    memory-pipeline.mdx
    troubleshooting.mdx
  developers/
    meta.json
    overview.mdx
    local-development.mdx
    server-api.mdx
    generated-cli.mdx
    database-ownership.mdx
    plugin-sdk.mdx
    slack-bridge.mdx
  operations/
    meta.json
    deployment.mdx
    observability.mdx
    troubleshooting.mdx
```

Conventions:

- `index.mdx` owns the `/docs` landing page. Do not create both `index.mdx` and another page intended to be `/docs`.
- Each directory with multiple pages should have a `meta.json` so sidebar order is deterministic.
- Prefer one page per durable capability owner. For example, `developers/database-ownership.mdx` should document database ownership constraints instead of mixing them into generic setup.
- Avoid deeply nested folders until there is enough content to justify them. Fumadocs can render nested trees, but a Linear-style documentation site should optimize first for fast scanning.

## `meta.json` conventions

Fumadocs uses `meta.json` files to control sidebar group metadata and page ordering. The current local schema is [documentations/source.config.ts](/Users/wibus/dev/Cradle/documentations/source.config.ts:14), using Fumadocs `metaSchema`.

Recommended shape:

```json
{
  "title": "Agents",
  "icon": "Bot",
  "pages": [
    "overview",
    "chat-runtime",
    "providers-and-models",
    "skills",
    "plugins",
    "browser-automation"
  ]
}
```

Rules:

- Use file slugs without `.mdx` in `pages`.
- Keep `pages` complete for each section. Missing files may still appear by default ordering, but deterministic navigation should not rely on implicit fallback.
- Use Lucide icon names because `lucideIconsPlugin()` is configured in [documentations/lib/source.ts](/Users/wibus/dev/Cradle/documentations/lib/source.ts:10).
- Do not use dynamic or localized file names. Keep slugs lowercase English kebab-case.
- If a folder needs a visible group page, use `overview.mdx` and place it first in `pages`; do not depend on folder index behavior unless explicitly verified.

## Frontmatter conventions

The current collection uses Fumadocs `pageSchema` at [documentations/source.config.ts](/Users/wibus/dev/Cradle/documentations/source.config.ts:9). Keep frontmatter minimal and schema-compatible:

```mdx
---
title: Agents
description: Configure providers, skills, tools, and execution boundaries for Cradle agents.
---
```

Recommended fields:

- `title`: required for page title, metadata, search and LLM output.
- `description`: required for `DocsDescription`, Open Graph metadata and useful search previews.
- `full`: optional boolean only for pages that truly need full-width layout.

Rules:

- Markdown正文使用简体中文。
- Code blocks, commands, paths, frontmatter keys, API names and identifiers stay in English.
- Keep titles short and stable. Put nuance in body text, not the navigation label.
- Every page should start with a direct outcome statement, then task-oriented sections.
- Relative links should target `.mdx` files. The page route wires `createRelativeLink(source, page)` at [documentations/app/docs/[[...slug]]/page.tsx](/Users/wibus/dev/Cradle/documentations/app/docs/[[...slug]]/page.tsx:37), so Fumadocs can resolve documentation-relative links.

## MDX components

The app currently exposes Fumadocs default MDX components through [documentations/components/mdx.tsx](/Users/wibus/dev/Cradle/documentations/components/mdx.tsx:3).

Use these components conservatively:

```mdx
<Callout type="info">
This behavior applies to local workspaces and generated CLI commands.
</Callout>

<Cards>
  <Card title="Server API" href="./server-api.mdx" />
  <Card title="Generated CLI" href="./generated-cli.mdx" />
</Cards>

<Tabs items={["pnpm", "bun"]}>
  <Tab value="pnpm">
    ```bash
    pnpm install
    ```
  </Tab>
  <Tab value="bun">
    ```bash
    bun install
    ```
  </Tab>
</Tabs>
```

Pitfalls:

- MDX component names must be available from Fumadocs defaults or explicitly added in `components/mdx.tsx`.
- Imports inside MDX are possible, but they increase build risk. Prefer default components for the first pass.
- JSX text inside examples above is English because code blocks and component bodies in handoff examples must stay English. Actual prose pages should use Chinese outside code.
- Do not add app-specific visual components unless they are needed across multiple pages. If added later, place them under `documentations/components/` and export them from `getMDXComponents()`.

## Search requirements

The route exists at [documentations/app/api/search/route.ts](/Users/wibus/dev/Cradle/documentations/app/api/search/route.ts:4).

Current concern: `language: 'english'` may be a poor fit because the planned documentation body is Chinese. Orama language support should be verified before implementation. If Chinese is unsupported in the exact installed stack, choose the least harmful option:

- Keep `language: 'english'` for technical identifiers and English slugs.
- Or omit the language option if Fumadocs/Orama defaults work better for mixed Chinese and English text.
- Then validate by searching for Chinese body terms and English identifiers in the browser.

Do not introduce a separate search index. `createFromSource(source)` should stay the single source of truth so page tree, routes, LLM text and search all use the same content collection.

## LLM text routes

The current implementation is aligned with the Fumadocs LLM integration pattern:

- `/llms.txt` returns an index from `llms(source).index()` at [documentations/app/llms.txt/route.ts](/Users/wibus/dev/Cradle/documentations/app/llms.txt/route.ts:7).
- `/llms-full.txt` returns concatenated processed Markdown at [documentations/app/llms-full.txt/route.ts](/Users/wibus/dev/Cradle/documentations/app/llms-full.txt/route.ts:6).
- Per-page Markdown is served under `/llms.mdx/docs/.../content.md` through [documentations/app/llms.mdx/docs/[[...slug]]/route.ts](/Users/wibus/dev/Cradle/documentations/app/llms.mdx/docs/[[...slug]]/route.ts:11).
- Markdown negotiation is handled by [documentations/proxy.ts](/Users/wibus/dev/Cradle/documentations/proxy.ts:14).

Required constraint:

- Keep `includeProcessedMarkdown: true` in [documentations/source.config.ts](/Users/wibus/dev/Cradle/documentations/source.config.ts:10). Removing it can break `page.data.getText('processed')` in [documentations/lib/source.ts](/Users/wibus/dev/Cradle/documentations/lib/source.ts:32).

Potential bug to verify during implementation:

- [documentations/app/llms.mdx/docs/[[...slug]]/route.ts](/Users/wibus/dev/Cradle/documentations/app/llms.mdx/docs/[[...slug]]/route.ts:18) returns `{ lang: page.locale, slug: ... }`, but the route path has no `[lang]` segment. If `next build` rejects extra static params for Next 16, remove `lang`. If build passes, leave it alone.

## Build and generation flow

Use commands from [documentations/package.json](/Users/wibus/dev/Cradle/documentations/package.json:5):

```bash
cd documentations
pnpm types:check
pnpm build
```

`pnpm types:check` is important because it runs:

```bash
fumadocs-mdx && next typegen && tsc --noEmit
```

That command regenerates `.source/`, updates Next route types, and catches MDX/frontmatter/type errors before build.

Optional manual checks after a successful build:

```bash
cd documentations
pnpm dev
```

Then inspect:

- `http://localhost:3000/docs`
- `http://localhost:3000/api/search`
- `http://localhost:3000/llms.txt`
- `http://localhost:3000/llms-full.txt`
- `http://localhost:3000/docs/getting-started.md`

## Constraints and pitfalls

- Missing `meta.json` files will not necessarily fail the build, but they can produce unstable or low-quality sidebars.
- Invalid `meta.json` page slugs can hide pages or produce confusing page tree order. Keep filenames and `pages` entries synchronized.
- Unsupported frontmatter fields can fail schema validation because `pageSchema` is used directly.
- Removing `description` creates weak metadata and may break assumptions in [documentations/app/docs/[[...slug]]/page.tsx](/Users/wibus/dev/Cradle/documentations/app/docs/[[...slug]]/page.tsx:27).
- MDX JSX must be syntactically valid. Unclosed cards, tabs and callouts will fail `fumadocs-mdx`.
- `llms-full.txt` depends on processed Markdown. Heavy custom React components may produce poor LLM text unless they degrade into readable Markdown.
- Relative documentation links should use local `.mdx` paths. Raw route paths work, but they are harder to maintain during file moves.
- [documentations/lib/shared.ts](/Users/wibus/dev/Cradle/documentations/lib/shared.ts:1) still contains placeholder `appName` and GitHub repository values. These affect navbar labels, GitHub links and view options, but changing them is implementation scope, not exploration scope.
- [documentations/app/layout.tsx](/Users/wibus/dev/Cradle/documentations/app/layout.tsx:11) uses `lang="en"`. The planned Chinese documentation may need `lang="zh-CN"` during implementation.
- [documentations/app/api/search/route.ts](/Users/wibus/dev/Cradle/documentations/app/api/search/route.ts:6) uses English search tokenization. Validate search quality with Chinese text before final acceptance.
- The current template pages [documentations/content/docs/index.mdx](/Users/wibus/dev/Cradle/documentations/content/docs/index.mdx:2) and [documentations/content/docs/test.mdx](/Users/wibus/dev/Cradle/documentations/content/docs/test.mdx:2) should be replaced or deleted in the implementation pass. Keeping `test.mdx` will leak scaffold content into the sidebar, search and LLM output.

## Recommended implementation checklist

1. Replace `documentations/content/docs/index.mdx` with the Cradle docs overview.
2. Remove `documentations/content/docs/test.mdx` once equivalent component smoke content is no longer needed.
3. Add the recommended folder tree and one `meta.json` per section.
4. Give every page schema-compatible frontmatter with `title` and `description`.
5. Use only default Fumadocs MDX components unless a shared custom component is clearly required.
6. Update `documentations/lib/shared.ts` with Cradle app name and GitHub repository metadata.
7. Decide whether `documentations/app/layout.tsx` should use `lang="zh-CN"`.
8. Revisit `documentations/app/api/search/route.ts` language configuration after Chinese content exists.
9. Run `cd documentations && pnpm types:check`.
10. Run `cd documentations && pnpm build`.
11. Manually inspect `/docs`, `/llms.txt`, `/llms-full.txt`, one `.md` URL, and search behavior.
12. If `next build` fails on `generateStaticParams()` for `/llms.mdx/docs`, remove the unused `lang` property from that route only.

## Bottom line

The local Fumadocs scaffold is structurally sufficient for the Cradle documentation site. The implementation should focus on a deterministic `content/docs` tree, complete `meta.json` ordering, schema-safe frontmatter, conservative MDX component use, and validation of Chinese search and LLM text output.
