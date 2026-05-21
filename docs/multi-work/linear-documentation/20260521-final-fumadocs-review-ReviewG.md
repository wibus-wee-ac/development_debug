# Final Fumadocs Review

## Verdict

FAIL.

The Fumadocs implementation is structurally close: the content tree is deterministic, scaffold pages are removed, `/llms.txt`, `/llms-full.txt`, per-page Markdown routes, and search route are present, and current generated artifacts show all 65 MDX pages were emitted to static HTML. The blocking issue is language-rule compliance in frontmatter values. There is also a shell metadata quality issue.

## Scope

Reviewed:

- `docs/exec-plans/20260521-05-linear-style-documentation.md`
- `docs/multi-work/linear-documentation/20260521-fumadocs-implementation-ExplorationC.md`
- `documentations/**`, excluding `node_modules`

No destructive changes were made. I did not run `pnpm types:check` or `pnpm build` because this review is read-only and those commands can rewrite generated `.source/`, `.next/types`, or build cache outputs. I inspected existing generated artifacts instead.

## Findings

### P1 - Frontmatter values violate the documented English frontmatter rule

The ExecPlan requires Markdown prose to be Simplified Chinese while code blocks, commands, paths, frontmatter, and identifiers stay English. Several pages use Chinese `title` and `description` values in frontmatter. These values are consumed by Fumadocs for page metadata, sidebar labels, search, and LLM output, so this is not isolated prose.

Concrete examples:

- `documentations/content/docs/index.mdx:2` uses `title: Cradle 文档`.
- `documentations/content/docs/index.mdx:3` uses a Chinese `description`.
- `documentations/content/docs/getting-started/overview.mdx:2` uses `title: 快速开始`.
- `documentations/content/docs/getting-started/overview.mdx:3` uses a Chinese `description`.
- `documentations/content/docs/getting-started/desktop-app.mdx:2` uses `title: 桌面端启动`.
- `documentations/content/docs/getting-started/desktop-app.mdx:3` uses a Chinese `description`.
- `documentations/content/docs/getting-started/first-workspace.mdx:2` uses `title: 第一个工作区`.
- `documentations/content/docs/getting-started/first-workspace.mdx:3` uses a Chinese `description`.
- `documentations/content/docs/getting-started/first-chat.mdx:2` uses `title: 第一段 Chat`.
- `documentations/content/docs/getting-started/first-chat.mdx:3` uses a Chinese `description`.
- `documentations/content/docs/chat/approvals.mdx:2` uses `title: 审批`.
- `documentations/content/docs/chat/approvals.mdx:3` uses a Chinese `description`.

Recommended fix: keep frontmatter values English, for example `title: Getting started` and an English `description`, while leaving page body prose in Simplified Chinese.

### P2 - `metadataBase` points to the GitHub repository, not the documentation site origin

`documentations/app/layout.tsx:17` sets:

```ts
metadataBase: new URL('https://github.com/wibus-wee/Cradle')
```

Next metadata uses this as the base for generated absolute metadata URLs. A repository URL is not the documentation deployment origin, so Open Graph images and canonical metadata can resolve to repository paths instead of docs-site paths.

Recommended fix: set `metadataBase` to the actual docs deployment origin when known, or omit it until deployment ownership is decided.

## Checks That Passed

### Content tree and sidebar determinism

The source tree contains 65 `.mdx` pages and 21 `meta.json` files. Every multi-page directory has a `meta.json`, and each `pages` array references existing pages or directories.

Key evidence:

- Root order is fixed in `documentations/content/docs/meta.json:3`.
- Major sections are listed through `documentations/content/docs/meta.json:5` to `documentations/content/docs/meta.json:15`.
- The nested developer tree is explicitly ordered in `documentations/content/docs/developers/meta.json:4` to `documentations/content/docs/developers/meta.json:14`.
- Section-level ordering exists for agents, chat, automation, Chronicle, integrations, Kanban, operations, troubleshooting, and workspace in their respective `meta.json` files.

No duplicate generated route was found by static route mapping.

### Scaffold cleanup

The default Fumadocs `test.mdx` page is no longer present. The landing page has been replaced with Cradle content in `documentations/content/docs/index.mdx:1`.

Searches for obvious scaffold terms found no retained template page. The remaining `占位` occurrences are warnings about app placeholder data, not documentation scaffold remnants:

- `documentations/content/docs/automation/runs-and-artifacts.mdx:10`
- `documentations/content/docs/getting-started/overview.mdx:42`

### Link conventions

Static parsing found no broken relative Markdown links. Internal documentation links use local `.mdx` targets, which matches the Fumadocs `createRelativeLink(source, page)` setup in `documentations/app/docs/[[...slug]]/page.tsx:37`.

Representative working links:

- `documentations/content/docs/index.mdx:10` links to `./getting-started/overview.mdx`.
- `documentations/content/docs/index.mdx:14` links to `./chat/overview.mdx`.
- `documentations/content/docs/agents/browser-use.mdx:71` links to `../integrations/browser-panel.mdx`.

### Search route

`documentations/app/api/search/route.ts:4` now uses `createFromSource(source)` without forcing English tokenization. This is better aligned with mixed Chinese prose and English identifiers than the earlier `language: 'english'` configuration.

### LLM routes

The LLM endpoints are present and use the shared Fumadocs source:

- `/llms.txt`: `documentations/app/llms.txt/route.ts:6` to `documentations/app/llms.txt/route.ts:7`
- `/llms-full.txt`: `documentations/app/llms-full.txt/route.ts:5` to `documentations/app/llms-full.txt/route.ts:9`
- Per-page Markdown: `documentations/app/llms.mdx/docs/[[...slug]]/route.ts:6` to `documentations/app/llms.mdx/docs/[[...slug]]/route.ts:15`
- Markdown negotiation: `documentations/proxy.ts:5` to `documentations/proxy.ts:12`, and request handling at `documentations/proxy.ts:14` to `documentations/proxy.ts:28`

`includeProcessedMarkdown` remains enabled in `documentations/source.config.ts:10` to `documentations/source.config.ts:12`, which preserves `/llms-full.txt` behavior through `getLLMText()` in `documentations/lib/source.ts:31` to `documentations/lib/source.ts:36`.

Existing generated output confirms `/llms-full.txt` includes processed page text:

- `documentations/.next/server/app/llms-full.txt.body:1` starts with `# Cradle 文档 (/docs)`.
- `documentations/.next/server/app/llms-full.txt.body:45` includes a second page, `# Browser use (/docs/agents/browser-use)`.

### Generated build artifacts

Existing build artifacts show all source pages were statically emitted:

- Source MDX count: 65
- Generated docs HTML count: 65, including `/docs`
- Missing HTML outputs: 0

This is not a substitute for a fresh validation run, but it is useful evidence that the current route tree and MDX syntax have recently built.

## Residual Risks

- `documentations/app/llms.mdx/docs/[[...slug]]/route.ts:20` returns `lang: page.locale` from `generateStaticParams()` even though the route path has no `[lang]` segment. Existing generated artifacts indicate the current build tolerated it, so I am not marking it as a blocking finding. It remains a small future compatibility risk if Next route param validation tightens.
- I found one apparent MDX import at `documentations/content/docs/developers/plugins/server-api.mdx:34`, but it is inside a fenced TypeScript example, so it is not a real MDX import risk.

## Recommendation

Fix the frontmatter language violations first, then run:

```bash
cd documentations
pnpm types:check
pnpm build
```

After that, spot-check `/docs`, `/api/search`, `/llms.txt`, `/llms-full.txt`, and a `.md` negotiated page such as `/docs/getting-started/overview.md`.
