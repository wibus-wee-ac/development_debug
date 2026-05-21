<!--
Output: Re-review of Cradle documentation coverage and Linear-style fidelity after ReviewF fixes.
Input: docs/exec-plans/20260521-05-linear-style-documentation.md, docs/multi-work/linear-documentation/*.md, and documentations/content/docs/**.
Position: Final re-review handoff for the Linear-style documentation workstream.
-->

# Final Coverage Re-review

Reviewer: `ReviewH`

Verdict: **FAIL**

本轮复审确认 ReviewF 的主要结构性缺口已经修复：plugin contract pages 已拆出，Slack bridge 已变成可执行配置指南，Browser Use command surface 已进入用户页和开发者页，System Info 已同时覆盖用户/admin 与开发者 contract，ExecPlan 状态也不再停留在实现前状态。

剩余阻塞点集中在 troubleshooting fidelity：部分排障页仍未充分使用仓库里已经存在的真实 codes、messages、status fields 和可观察 UI 文案。Linear-style 文档可以短，但排障页需要让读者按实际错误定位，而不是只按通用症状猜测。

## Acceptance Summary

- ReviewF plugin contract findings: **Pass**. `developers/plugins/meta.json` 暴露 `web-api`、`desktop-api`、`browser-use` 和 `system-info`，并且这些页面包含 owner、namespace、context/API、lifecycle、limits 和 validation。
- ReviewF Slack bridge finding: **Pass**. `integrations/slack-bridge.mdx` 已包含 Slack app、Socket Mode、tokens/scopes、slash command、event subscriptions、env、MCP client、bind/status/unbind、verify flow 和 troubleshooting。
- ReviewF Browser Use finding: **Pass**. `agents/browser-use.mdx` 已列出 MCP tool families、典型流程、permission/trust、runtime contract、registration verification 和 failure modes。
- ReviewF System Info finding: **Pass**. `integrations/system-info.mdx` 和 `developers/plugins/system-info.mdx` 已覆盖 route、panel、command、data exposure、failure states 和 validation。
- ReviewF troubleshooting finding: **Partial / Fail**. Provider、Git、Slack bridge 和 Devtools export 已 grounded in real codes/messages；Desktop server 和 Chronicle troubleshooting 仍是 generic symptom tables，未使用已有源码证据。
- ReviewF ExecPlan finding: **Pass**. ExecPlan 已记录 ReviewF/ReviewG、修复项、typecheck/build 结果、metadataBase decision 和剩余复审/smoke check。
- Original product coverage matrix: **Partial pass**. 顶层 IA 覆盖 overview/get started、desktop、workspace、chat、agents/providers/models、skills、approvals、git、kanban/issue agents、automation、Chronicle、observability/devtools、browser/plugin use、settings、Slack bridge 和 troubleshooting。
- Original developer coverage matrix: **Pass with acceptable consolidation**. Developer section 覆盖 server, HTTP/OpenAPI, generated CLI, runtime, plugins, database, automation, desktop, testing, docs contribution；server module details are consolidated rather than split per module, which is acceptable for this docs pass.
- Linear-style fidelity: **Partial pass**. Most fixed pages are task-oriented and concrete. The remaining troubleshooting pages are short but shallow.

## Fixed Findings From ReviewF

### Plugin contracts

Status: **Fixed**

Evidence:

- `documentations/content/docs/developers/plugins/meta.json` lists `web-api`, `desktop-api`, `browser-use`, and `system-info`.
- `documentations/content/docs/developers/plugins/web-api.mdx` documents `WebPluginContext`, `registerPanel`, `registerCommand`, storage, logger, namespace rules, lifecycle, validation, and limits.
- `documentations/content/docs/developers/plugins/desktop-api.mdx` documents `DesktopPluginContext`, webview hooks, browser tab APIs, shared config, lifecycle, Browser Use example, validation, and limits.
- `documentations/content/docs/developers/plugins/browser-use.mdx` documents first-party plugin ownership, socket/shared config, protocol commands, MCP tools, desktop lifecycle, response shape, validation, and limits.
- `documentations/content/docs/developers/plugins/system-info.mdx` documents route, panel, command, storage key, data shape, lifecycle, validation, and limits.

Assessment:

This now satisfies the developer matrix requirement for plugin SDK contracts and first-party plugin contract pages. It also follows the owner/namespace principle instead of treating examples as loose snippets.

### Slack bridge guide

Status: **Fixed**

Evidence:

- `documentations/content/docs/integrations/slack-bridge.mdx` includes Slack app creation, Socket Mode, App-Level Token, bot scopes, slash command, event subscriptions, env vars, run commands, MCP config, `/zhi bind`, `/zhi status`, `/zhi unbind`, verification, data ownership, troubleshooting, and limits.

Assessment:

The page is now actionable enough for a reader to configure the independent bridge without returning to the app README for basic setup.

### Browser Use command surface

Status: **Fixed**

Evidence:

- `documentations/content/docs/agents/browser-use.mdx` lists `browser_navigate`, `browser_get_text`, `browser_dom_snapshot`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_hover`, `browser_scroll`, `browser_keyboard`, `browser_eval`, `browser_tabs_list`, `browser_tabs_new`, `browser_tabs_close`, and `browser_wait_for_selector`.
- The same page includes runtime contract, socket path, registration checks, failure modes, and limits.
- `documentations/content/docs/developers/plugins/browser-use.mdx` provides the developer-level command/protocol mapping.

Assessment:

The product page now distinguishes browser panel from agent automation while still documenting the usable command surface.

### System Info coverage

Status: **Fixed**

Evidence:

- `documentations/content/docs/integrations/system-info.mdx` covers the admin/user-visible route, panel, command, exposed fields, validation path, failure modes, and limits.
- `documentations/content/docs/developers/plugins/system-info.mdx` covers the developer contract and route/data shape.
- `documentations/content/docs/integrations/meta.json` exposes `system-info`.

Assessment:

System Info is now covered as a first-party plugin, not only as a developer example.

### ExecPlan status

Status: **Fixed for ReviewF scope**

Evidence:

- `docs/exec-plans/20260521-05-linear-style-documentation.md` records ReviewF and ReviewG failures, the subsequent fixes, `pnpm types:check`, `pnpm build`, and current remaining review/smoke status.

Assessment:

The previous contradiction is gone. The remaining unchecked复审/smoke item is expected because this ReviewH is the re-review artifact.

## Remaining Findings

### 1. Desktop server troubleshooting is still generic and misses real messages

Severity: Medium

`documentations/content/docs/troubleshooting/desktop-server.mdx` still maps only broad symptoms to broad recovery actions. The page does not use concrete desktop/server messages that are already visible in the codebase.

Evidence:

- `documentations/content/docs/troubleshooting/desktop-server.mdx:20-27` lists `Blank UI`, `All API calls fail`, `Plugin commands missing`, and `One module fails` without concrete message/status mapping.
- `apps/desktop/src/main/server-process.ts:84` logs `[desktop] Server process exited unexpectedly (code=${code}, signal=${signal})`.
- `apps/desktop/src/main/server-process.ts:88` logs `[desktop] Restarting server (attempt ${restartCount}/${MAX_RESTARTS})...`.
- `apps/desktop/src/main/server-process.ts:90` logs `[desktop] Server restart failed:`.
- `apps/desktop/src/main/server-process.ts:152-154` shows a dialog with `Server Error`, `The Cradle server has stopped unexpectedly.`, and `Exit code: ${exitCode}`.
- `apps/desktop/src/main/server-process.ts:188` throws `Server failed to start within ${timeoutMs}ms`.
- `apps/web/src/features/devtool/health/health-panel.tsx:52-57` shows `Failed to fetch server health:` plus the fetch/HTTP error.

Impact:

A user seeing the crash dialog, health panel error, or desktop log line still cannot map that exact observable message to recovery and verification steps from this page.

Recommended fix:

Add a message-driven table with rows for:

- `The Cradle server has stopped unexpectedly.`
- `Exit code: ...`
- `[desktop] Server process exited unexpectedly`
- `[desktop] Server restart failed:`
- `Server failed to start within ...ms`
- `Failed to fetch server health: HTTP ...`

Each row should include likely cause, reversible recovery, where to verify, and when to export Devtools data.

### 2. Chronicle troubleshooting does not use existing Chronicle status fields or messages

Severity: Medium

`documentations/content/docs/troubleshooting/chronicle.mdx` is accurate at a high level, but it is not grounded in the actual Chronicle status fields, event messages, and summary failure strings that the server exposes.

Evidence:

- `documentations/content/docs/troubleshooting/chronicle.mdx:21-28` lists `No capture`, `No resources`, `No memories`, and `Empty timeline` without actual status fields or messages.
- `apps/server/src/modules/chronicle/service.ts:269-272` records daemon events with `Chronicle daemon start requested` and `Chronicle daemon failed to start`.
- `apps/server/src/modules/chronicle/service.ts:291-292` returns `[Chronicle error - ${failure}]`.
- `apps/server/src/modules/chronicle/service.ts:299-301` returns `[Chronicle error - no API key available for profile]`.
- `apps/server/src/modules/chronicle/service.ts:375-389` exposes `available`, `running`, `pid`, `lastCaptureAt`, `lastSummaryAt`, `lastErrorAt`, `lastError`, `lastExitCode`, `lastExitAt`, `totalSnapshots`, `totalSummaries`, and `configuredModel`.
- `chronicle/src/daemon.rs` contains operator-visible messages such as `cradle chronicle capture error: ...`, `cradle chronicle summary error: ...`, and `another Chronicle instance is already running ...`.

Impact:

Chronicle is one of the more complex product areas. A generic page is not enough for Linear-style operational help because readers need to distinguish disabled capture, daemon start failure, provider/profile failure, missing API key, no snapshots, no memories, and daemon exit.

Recommended fix:

Add a status/message table keyed by:

- `available=false`
- `running=false`
- `lastExitCode`
- `lastError`
- `Chronicle daemon failed to start`
- `[Chronicle error - no API key available for profile]`
- `totalSnapshots=0`
- `totalSummaries=0`
- `macOS capture is only available on macOS`
- `another Chronicle instance is already running`

Each row should include what to inspect in Settings, `GET /chronicle/status`, model/provider settings, permissions, and local daemon logs.

## Coverage Matrix Re-check

### Product matrix

The final tree covers the minimum product areas from ExplorationD:

- overview/get started: `index`, `getting-started/*`
- desktop app: `getting-started/desktop-app`, `operations/desktop-server`, `troubleshooting/desktop-server`
- web workspace: `workspace/*`
- chat and composer: `chat/*`
- agents/providers/models/skills/browser-use: `agents/*`
- approvals/session awaits: `chat/approvals`, `chat/session-awaits`
- git/workspace: `workspace/git`, `troubleshooting/workspace-git`
- kanban and issue agents: `kanban/*`
- automation: `automation/*`
- Chronicle: `chronicle/*`, `troubleshooting/chronicle`
- observability/devtools: `operations/observability`, `operations/devtools`, `troubleshooting/devtools-export`
- browser panel/plugin use: `integrations/browser-panel`, `agents/browser-use`, `integrations/plugins`
- settings/usage: `operations/settings`, `operations/usage`
- Slack bridge: `integrations/slack-bridge`, `troubleshooting/slack-bridge`
- troubleshooting: `troubleshooting/*`

The only material product coverage weakness after fixes is the depth of Chronicle and desktop server troubleshooting.

### Developer matrix

The final developer tree covers the minimum developer areas from ExplorationE:

- server architecture and module map: `developers/server/*`
- HTTP/OpenAPI: `developers/server/http-foundation`, `developers/api/openapi`
- generated CLI and runtime: `developers/cli/*`
- database ownership and migrations: `developers/database/*`
- plugin SDK, lifecycle, server/web/desktop APIs, Browser Use, System Info: `developers/plugins/*`
- runtime provider integration: `developers/runtime/provider-integrations`
- automation agents: `developers/automation/agents`
- desktop integration: `developers/desktop/integration`
- testing and docs contribution: `developers/contributing/*`

The developer tree is consolidated, but it is no longer missing the ReviewF contract pages.

## Linear-style Fidelity Re-check

Fixed pages now mostly follow the Linear-style target:

- short opening paragraph that defines the object and boundary;
- task sections before reference detail;
- tables for permissions, commands, data surfaces, failure modes, and limits;
- explicit ownership and namespace statements for developer pages;
- next-step links.

The remaining desktop server and Chronicle troubleshooting pages break the same pattern because they stop at generic symptoms. They should use the concrete messages/statuses users see, then give recovery and verification.

## Final Verdict

**FAIL** until desktop server and Chronicle troubleshooting are grounded in the real messages/status fields already present in the codebase.

This is a narrow remaining failure. ReviewF's structural coverage issues are otherwise fixed.
