<!--
Input: Alma WebSearch/WebFetch evidence and Cradle browser panel audit.
Output: Spec for web search and fetch services.
Position: docs/specs/alma-inspired/websearch-webfetch.md
-->

# WebSearch And WebFetch

## Goal

Cradle should provide agent-readable web search and fetch services separate from human browser navigation.

## Alma Evidence

Alma exposes WebSearch and WebFetch debug windows, Google and Xiaohongshu flows, cookie import/export/clear, hidden browser search, Readability extraction, Turndown Markdown conversion, recaptcha detection, and cookie sync between Electron sessions.

## Cradle Current State

Cradle has an embedded browser panel and browser-use MCP tools. No web search/fetch service with cookie tooling, readability extraction, or source markdown conversion was found.

## Target Ownership

A future `web-fetch` module owns fetch/search requests, extraction, markdown conversion, cache, and source provenance. Browser plugins may supply interactive session support.

## Target Behavior

- Agents can request web fetch and receive title, URL, markdown, extracted text, and metadata.
- Search engines are configured with explicit policy and rate limits.
- Cookie import/export is scoped to a named browser context and never automatic across products.
- Debug windows are available for login or captcha recovery.

## API Sketch

- `POST /web-fetch/fetch`
- `POST /web-fetch/search`
- `GET /web-fetch/contexts`
- `POST /web-fetch/contexts/:id/cookies/import`
- `GET /web-fetch/contexts/:id/cookies/export`

## Data Model

Persist fetch cache entries, source metadata, and browser context records. Cookie material should live in desktop/browser storage or encrypted secrets, not plain DB rows.

## Acceptance

- Fetching a page returns markdown with source URL and extraction method.
- Search results include ranking, title, snippet, and URL.
- Cookie operations require explicit user action.
