<!--
Input: Alma WebSearch/WebFetch evidence and Cradle browser panel audit.
Output: Spec for web search and fetch services.
Position: docs/specs/alma-inspired/websearch-webfetch.md
-->

# WebSearch 与 WebFetch

## 目标

Cradle 需要提供 agent-readable web search 与 web fetch service，并与人类手动 browser navigation 分离。

## Alma 证据

Alma 暴露 WebSearch 和 WebFetch debug windows、Google/Xiaohongshu flows、cookie import/export/clear、hidden browser search、Readability extraction、Turndown Markdown conversion、recaptcha detection，以及 Electron sessions 间 cookie sync。

## Cradle 当前状态

Cradle 有 embedded browser panel 和 browser-use MCP tools。未发现带 cookie tooling、readability extraction、source markdown conversion 的 web search/fetch service。

## Owner / Namespace

未来 `web-fetch` module 拥有 fetch/search requests、extraction、markdown conversion、cache、source provenance。Browser plugins 可以提供 interactive session support。

## 目标行为

- Agents 可以请求 web fetch，并收到 title、URL、markdown、extracted text、metadata。
- Search engines 配置有明确 policy 和 rate limits。
- Cookie import/export 只作用于命名 browser context，不能跨产品自动同步。
- Debug windows 用于 login 或 captcha recovery。

## API 草案

- `POST /web-fetch/fetch`
- `POST /web-fetch/search`
- `GET /web-fetch/contexts`
- `POST /web-fetch/contexts/:id/cookies/import`
- `GET /web-fetch/contexts/:id/cookies/export`

## 数据模型

持久化 fetch cache entries、source metadata、browser context records。Cookie material 应位于 desktop/browser storage 或 encrypted secrets，不能明文存 DB。

## 验收

- Fetch page 返回 markdown，并带 source URL 和 extraction method。
- Search results 包含 ranking、title、snippet、URL。
- Cookie operations 需要显式用户动作。
