<!--
Output: Final coverage and Linear-style fidelity review for the Cradle documentation content.
Input: docs/exec-plans/20260521-05-linear-style-documentation.md, docs/multi-work/linear-documentation/*.md, and documentations/content/docs/**.
Position: Review handoff for the Linear-style documentation workstream.
-->

# Final Coverage Review

Reviewer: `ReviewF`

Verdict: **FAIL**

The documentation set is directionally strong and covers most top-level Cradle product domains. It uses task-oriented IA, short prose, explicit limits, and a separated developer section. It is not ready to pass the stated acceptance criteria because several required matrices are only partially covered, and some pages are too skeletal for readers to complete real operations without returning to code or README files.

## Acceptance Summary

- Explicit user objective: **Partial**. The docs provide a readable Fumadocs tree for users, admins, operators, and developers, but not all required capabilities have enough actionable detail.
- Product matrix: **Partial pass**. Core product areas exist: getting started, workspace, chat, agents, kanban, automation, Chronicle, integrations, operations, troubleshooting. Weak spots are Slack bridge setup, browser-use commands, plugin/system-info user coverage, and error-code troubleshooting.
- Developer matrix: **Partial pass**. Server, OpenAPI, generated CLI, database ownership, plugin SDK, runtime providers, automation, desktop, testing, and docs contribution pages exist. Missing or collapsed contract pages reduce fidelity for plugin web/desktop APIs and first-party plugin contracts.
- Linear-style fidelity: **Partial pass**. Most pages use short direct prose, clear first paragraphs, limits, and next steps. Several pages stay at outline level and do not satisfy Linear-style task completion.
- Scaffold/stale text: **Fail**. The ExecPlan still says major implementation and final audit steps are incomplete, which conflicts with the completed-docs review state.

## Findings

### 1. Missing dedicated plugin contract pages weaken developer coverage

Severity: High

The developer coverage handoff marks plugin SDK, lifecycle, Browser Use, System Info, web API, desktop API, storage, events, permissions, testing, and publishing as developer coverage targets. The final sidebar only exposes `sdk-overview`, `lifecycle`, `server-api`, and `examples`.

Evidence:

- `documentations/content/docs/developers/plugins/meta.json:4-8` lists only `sdk-overview`, `lifecycle`, `server-api`, and `examples`.
- `documentations/content/docs/developers/plugins/sdk-overview.mdx:47-56` gives a generic capability checklist, but not concrete web/desktop API contracts.
- `documentations/content/docs/developers/plugins/lifecycle.mdx:57` explicitly says desktop and web loader lifecycle still need verification before detailed guarantees.
- `docs/multi-work/linear-documentation/20260521-cradle-developer-coverage-ExplorationE.md:79-111` recommends separate developer pages including plugin lifecycle and bundled plugin examples, with `browser-use` and `system-info` called out.
- `docs/multi-work/linear-documentation/20260521-cradle-developer-coverage-ExplorationE.md:114` names `plugins/sdk-overview` and `plugins/lifecycle` as non-negotiable, but the wider matrix also expects web/desktop/plugin examples to be documented as contracts, not only mentioned.

Impact:

Plugin authors do not get Linear-style developer contract pages for `WebPluginContext`, `DesktopPluginContext`, permissions, publishing, or stable first-party plugin behavior. The docs explain ownership, but not enough API surface to build against the SDK confidently.

Recommended fix:

Add dedicated pages or expand the current plugin section with clear contracts for web plugin API, desktop plugin API, storage/events/hooks/permissions, and first-party Browser Use/System Info pages. Keep examples short, but include the stable interface and validation path.

### 2. Slack bridge page is too skeletal to satisfy the integration task objective

Severity: High

The product matrix says Slack bridge documentation should cover Slack app setup, Socket Mode, tokens/scopes, slash command, channel bind, MCP client config, runtime flow, and troubleshooting. The final page lists these as prerequisites but does not give enough task detail to complete setup.

Evidence:

- `documentations/content/docs/integrations/slack-bridge.mdx:12-23` lists prerequisites only.
- `documentations/content/docs/integrations/slack-bridge.mdx:25-33` gives a high-level seven-step flow without command names, env vars, scopes, binding commands, or verification.
- `documentations/content/docs/integrations/slack-bridge.mdx:37` mentions production deployment and secret storage but leaves the policy to the reader.
- `docs/multi-work/linear-documentation/20260521-cradle-product-coverage-ExplorationD.md:62` says the Slack bridge page should cover Slack app setup, tokens/scopes, slash command, channel bind, MCP client config, bind/status/unbind, and timeout behavior.

Impact:

The page has correct boundaries, but it does not let a reader complete the integration from the docs. This falls short of the ExecPlan objective that readers should be able to use the docs for real operations.

Recommended fix:

Add a task guide with exact environment variables, required Slack scopes, Socket Mode setup, slash command setup, channel bind/status/unbind flow, MCP client config shape, verification checks, and recovery steps for token/socket/channel failures.

### 3. Browser-use product coverage avoids the core command surface

Severity: Medium

Browser-use is an explicit acceptance target. The user-facing page correctly separates browser panel from agent browser automation, but then declines to list the automation commands and sends users to Devtools instead.

Evidence:

- `documentations/content/docs/agents/browser-use.mdx:14-16` explains the user panel, plugin path, and legacy backend boundary.
- `documentations/content/docs/agents/browser-use.mdx:24` says the page does not list the automation command set and tells users to inspect Devtools.
- `documentations/content/docs/developers/plugins/examples.mdx:14-17` lists some Browser Use MCP tools, but only in a developer examples page.
- `docs/multi-work/linear-documentation/20260521-cradle-product-coverage-ExplorationD.md:127-129` says browser panel and browser-use plugin should be distinguished and that plugin package details are needed for precise commands and limits.
- `docs/exec-plans/20260521-05-linear-style-documentation.md:91` includes `browser-use plugin` in the minimum coverage list.

Impact:

The page preserves accuracy but misses the practical contract a user or operator needs: what can the agent do, what permission is needed, what fails, and how to verify the plugin is registered.

Recommended fix:

Document the currently supported command/tool families from `plugins/browser-use`, with a short feature support table, permissions, desktop-only limit, active tab behavior, failure modes, and a link to developer implementation details.

### 4. Troubleshooting coverage is present but not grounded in actual error codes or recovery maps

Severity: Medium

The docs include a troubleshooting section, but the top-level page and several linked pages remain generic. The product coverage handoff asked for real error-code/message-driven maps for provider, git, Chronicle, Slack, observability export, and desktop server failures.

Evidence:

- `documentations/content/docs/troubleshooting/index.mdx:12-19` provides generic quick checks.
- `documentations/content/docs/troubleshooting/index.mdx:30-39` lists diagnostics to collect, but not error-specific recovery paths.
- `documentations/content/docs/troubleshooting/devtools-export.mdx:24-30` describes the export workflow, but not what events or incident codes to look for.
- `documentations/content/docs/operations/observability.mdx:14-20` lists filter dimensions, but not event codes or severity meanings.
- `docs/multi-work/linear-documentation/20260521-cradle-product-coverage-ExplorationD.md:141` says troubleshooting should be organized from actual error codes and messages.

Impact:

The troubleshooting IA is good, but it is not yet Linear-style operational help. Readers can collect information, but not reliably diagnose or recover specific common failures.

Recommended fix:

Add symptom tables with exact observed error codes/messages where available. For each issue, include likely cause, reversible recovery action, verification, and when to escalate.

### 5. System Info plugin is only an example, not a covered first-party plugin page

Severity: Medium

The acceptance matrix explicitly includes `system-info plugin`. The final docs mention System Info only inside a developer example page. There is no user/admin page for what it is, how it appears, what route/panel/command it registers, or how to troubleshoot it.

Evidence:

- `documentations/content/docs/developers/plugins/examples.mdx:31-46` describes System Info as an example.
- `documentations/content/docs/integrations/meta.json:4` lists only `overview`, `slack-bridge`, `browser-panel`, and `plugins`; no System Info page exists.
- `documentations/content/docs/developers/plugins/meta.json:4-8` also has no dedicated System Info page.
- `docs/exec-plans/20260521-05-linear-style-documentation.md:91` includes `system-info plugin` in the required coverage list.

Impact:

The plugin is covered as evidence for SDK boundaries, but not as a product/developer contract page. This is weak coverage against the explicit objective.

Recommended fix:

Add either `integrations/system-info.mdx` or `developers/plugins/system-info.mdx`, depending on intended audience. Include owner, registered route, panel, command, permissions, data exposed, failure states, and validation.

### 6. ExecPlan status is stale and contradicts the completed-documentation review state

Severity: Low

The plan still says implementation, build validation, and final audit are incomplete. For a completed content review, this reads as stale scaffold/process text.

Evidence:

- `docs/exec-plans/20260521-05-linear-style-documentation.md:18-22` still has unchecked progress items for research, implementation, build validation, and final audit.
- `docs/exec-plans/20260521-05-linear-style-documentation.md:45` says the work is not complete.
- `docs/exec-plans/20260521-05-linear-style-documentation.md:78-83` requires running `pnpm typecheck` and `pnpm build`, but the plan does not record whether that happened.

Impact:

This does not directly break the content pages, but it weakens the handoff evidence and makes it unclear whether acceptance was verified.

Recommended fix:

Update the ExecPlan progress, outcomes, validation commands, and any remaining gaps after the content fixes. If build/typecheck were not run, record that explicitly.

## Coverage Notes

Strong areas:

- Product IA is broadly aligned with the matrix: `getting-started`, `workspace`, `chat`, `agents`, `kanban`, `automation`, `chronicle`, `integrations`, `operations`, `developers`, and `troubleshooting` exist in `documentations/content/docs/meta.json`.
- The landing page states reader groups and task-domain organization clearly at `documentations/content/docs/index.mdx:17`.
- Risky product claims are mostly bounded: Home mock data is called out at `documentations/content/docs/getting-started/overview.mdx:42`, Slack bridge is not misrepresented as built-in at `documentations/content/docs/integrations/slack-bridge.mdx:6`, and `Always Allow` scope is caveated at `documentations/content/docs/chat/approvals.mdx:29`.
- Developer pages consistently use owner, namespace, lifecycle, validation, and limits sections.

Remaining risk:

- Several product pages are accurate but too thin. Linear-style docs should be short, but not shallow. The pages that explain integrations and runtime contracts need enough concrete setup, verification, limits, and recovery detail for the reader to finish the task.

