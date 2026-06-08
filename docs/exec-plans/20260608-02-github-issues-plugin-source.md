# Build a GitHub Issues Source Plugin and Read-Only Kanban Projection

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not currently check in a root-level `PLANS.md`. This document is authored and must be maintained in accordance with `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained so a contributor can resume the work with only this file and the repository checkout.

## Purpose / Big Picture

Cradle should be able to read GitHub Issues through a plugin and show them on the Kanban board without creating normal Cradle Issue rows. After this change, a developer can enable the first-party `github-issues` plugin, configure one or more GitHub repositories, run a Cradle-owned refresh command for a workspace, and see GitHub issues appear in the board as read-only external issue cards. If the plugin is removed or stops registering its source, the external issue projection rows remain as Cradle-owned provenance and overlay state, while the source is marked unregistered and can reconnect on reinstall without duplicating board cards.

This plan deliberately avoids the plugin install marketplace. The first implementation uses a first-party plugin under `plugins/github-issues` and the existing workspace plugin loading flow. The important product behavior is the projection boundary: plugin code reads GitHub and returns a fixed snapshot shape; Cradle external issue source code owns dedupe, external issue rows, board read projection, lifecycle states, and CLI/API semantics. The plugin does not write issue tables, and the projection service does not create `kanban_issues` rows.

## Progress

- [x] (2026-06-08 02:04 CST) Read the ExecPlan skill and `/Users/wibus/.agents/skills/execplan/references/PLANS.md`; confirmed this plan must be self-contained, living, outcome-focused, and stored under `docs/exec-plans/`.
- [x] (2026-06-08 02:04 CST) Inspected current plugin storage, server plugin source registry, external provider source registry, external provider source projection service, issue service, and issue schema.
- [x] (2026-06-08 02:04 CST) Created this ExecPlan for a GitHub Issues source plugin plus Cradle-owned issue projection.
- [x] (2026-06-08 02:18 CST) Revised the plan from "import into Cradle issues" to "read-only external issue projection on Kanban" after product clarification: GitHub issues must not become normal Cradle issue rows, only their local Kanban status can be edited.
- [x] (2026-06-08 02:31 CST) Added workspace repository binding, manual-first sync, ETag-aware refresh, and rate-limit protection requirements after product questions about update frequency and how to start syncing a repository into a workspace.
- [x] (2026-06-08 02:39 CST) Added a lightweight Settings entry for creating repository bindings, manual refresh, and optional scheduled sync after product clarification that users should be able to start sync from Settings.
- [x] (2026-06-08 03:06 CST) Implemented Milestone 1: added `ctx.issues.externalSources.register(...)`, source snapshot types, server registry, plugin context injection, and loader reset.
- [x] (2026-06-08 03:06 CST) Implemented Milestone 2: added Cradle-owned external issue source, binding, repository cursor, and item schema plus migration `0066_external_issue_sources.sql`.
- [x] (2026-06-08 03:06 CST) Implemented Milestone 3 backend routes and projection service: source/binding/item list, binding create/update/delete, binding/source refresh, read-only edit rejection, status-only item move, shared repository cursor/ETag/rate-limit handling, and fetch coalescing.
- [x] (2026-06-08 03:06 CST) Implemented Milestone 3 frontend read projection: Kanban reads external items beside native issues, visually marks them as GitHub/external, opens a read-only external detail panel, and sends only status moves to the external item status API.
- [x] (2026-06-08 03:06 CST) Implemented Milestone 3 Settings entry: Settings > GitHub Issues lists sources and workspace bindings, creates `owner/repo` bindings, refreshes, enables/disables, toggles hourly schedule, and deletes bindings through Cradle-owned APIs.
- [x] (2026-06-08 03:06 CST) Implemented Milestone 4: added first-party `plugins/github-issues` server plugin with REST mapping, ETag, 304, pagination, pull request filtering, rate-limit metadata, env config, and mocked unit tests.
- [x] (2026-06-08 03:06 CST) Implemented Milestone 5 focused server tests for no normal issue creation, projection, label mapping, status overlay preservation, read-only guard, not-modified handling, missing marking, and coalesced fetch.
- [x] (2026-06-08 03:09 CST) Completed Milestone 6 final validation: regenerated CLI and web API, reran focused server/plugin tests, reran web/CLI/server/plugin-sdk/GitHub plugin typechecks, built the GitHub plugin, and confirmed the plugin does not import DB or issue modules.

## Surprises & Discoveries

- Observation: `plugin_storage_entries` is persistent plugin-scoped KV, not a suitable place for GitHub Issue to Cradle Issue projection ownership.
  Evidence: `apps/server/src/plugins/storage.ts` exposes only `get`, `set`, and `delete` by `pluginName + key`, while `packages/db/src/schema/plugin.ts` stores opaque string values. There is no workspace, issue id, external id, lifecycle status, or dedupe constraint.

- Observation: The existing external provider source system already has the right pattern for plugin-provided data sources.
  Evidence: `apps/server/src/plugins/external-provider-source-registry.ts` stores registered source readers in memory and derives a stable `sourceKey` from plugin owner plus source id. `apps/server/src/modules/external-provider-sources/service.ts` reads those sources, validates snapshots, and writes Cradle-owned `external_provider_sources`, `external_provider_records`, and `provider_targets` rows.

- Observation: External provider source refresh handles records that disappear from a still-registered source, but it does not fully model plugin/source uninstall as a visible persisted lifecycle state.
  Evidence: `refreshSourceSnapshot()` marks missing records as `missing` and disables provider targets/agents, but `listExternalProviderSources()` starts from currently registered sources only. A plugin that no longer registers its source may leave persisted source rows that are not clearly surfaced as unregistered.

- Observation: The Issue module is the owner of Cradle Issue semantics and already includes activity, field-change, context ref, status, comment, relation, and actor provenance behavior.
  Evidence: `apps/server/src/modules/issue/README.md` says the module owns issue CRUD, workflow statuses, raw field-change audit history, Activity projection, relations, context refs, session links, delegation markers, actor provenance, and search semantics.

- Observation: The product requirement is not to import GitHub Issues as normal Cradle issues.
  Evidence: Wibus clarified that GitHub-synced items visible in the Kanban board must be read-only except for status, labels must be directly mapped from GitHub, and the system should not directly create Cradle issues.

- Observation: GitHub synchronization needs an explicit workspace binding and rate-limit-safe refresh policy.
  Evidence: Wibus asked how update frequency works, warned that multiple syncs can cause GitHub rate limit problems, and asked how to start syncing a repository into a specific Workspace.

- Observation: Users need a Settings entry to start and manage GitHub issue synchronization.
  Evidence: Wibus clarified that Settings should provide a place for users to start syncing a repository.

- Observation: Web OpenAPI generation initially failed to activate the GitHub Issues plugin when `plugins/github-issues/dist/server.mjs` was missing, then succeeded after building the plugin package.
  Evidence: Rerunning `pnpm generate:web` after `pnpm --filter @cradle/github-issues build` logged `GitHub Issues plugin activated` and generated `apps/web/src/api-gen`.

- Observation: The generated API had create/delete/refresh routes but Settings needed a host-owned way to change `enabled`, `scheduleEnabled`, and `refreshIntervalSeconds`.
  Evidence: Added `PATCH /external-issue-sources/bindings/:bindingId`; the generated web client now includes `patchExternalIssueSourcesBindingsByBindingId`.

## Decision Log

- Decision: The GitHub plugin must not directly write `kanban_issues`, `kanban_issue_comments`, or any issue-owned table.
  Rationale: GitHub is an external namespace and the plugin is only an adapter. Cradle external issue source code must own snapshot validation, dedupe, external item persistence, status overlay, lifecycle, and cleanup behavior.
  Date/Author: 2026-06-08 / Codex.

- Decision: GitHub Issues must be persisted as external issue projection rows, not as `kanban_issues`.
  Rationale: The user expects GitHub issues to appear on Kanban without becoming editable Cradle issues. Creating normal issue rows would incorrectly allow title, description, label, comment, relation, delegation, and context-ref workflows unless every path added special guard code. A separate external issue projection keeps ownership explicit.
  Date/Author: 2026-06-08 / Codex.

- Decision: The only locally editable field for a GitHub issue projection is Kanban status.
  Rationale: Status is Cradle's board organization overlay. GitHub title, body, labels, assignees, milestone, state, number, URL, and timestamps are source-owned and must refresh from GitHub. The detail view may show those fields and link to GitHub for editing, but Cradle should not edit them in the first version.
  Date/Author: 2026-06-08 / Codex.

- Decision: Implement a fixed `ExternalIssueSource` contract instead of using plugin routes as an ad hoc import API.
  Rationale: Plugin routes would force each plugin to invent its own shape and would make dedupe, permissions, CLI, lifecycle, and status projection inconsistent. A fixed source contract lets the host validate snapshots and keep all writes in a Cradle-owned module.
  Date/Author: 2026-06-08 / Codex.

- Decision: Store GitHub Issue projection state in Cradle-owned source/item tables, not in `plugin_storage_entries`.
  Rationale: Projection state is product state, not plugin-private cache. It needs workspace id, local status id, external ids, fingerprints, source fields, timestamps, and unique constraints that survive plugin unload and reinstall.
  Date/Author: 2026-06-08 / Codex.

- Decision: Plugin uninstall or source unregistration must not delete external issue projection rows by default.
  Rationale: The rows contain Cradle-owned provenance and the user's local board status overlay. Source unregistration should stop sync and mark the source inactive, not destroy board organization.
  Date/Author: 2026-06-08 / Codex.

- Decision: The first implementation includes a lightweight Settings management UI, but no browser automation or frontend component tests.
  Rationale: Users need a visible product path to bind a GitHub repository to a workspace and start refresh. The UI should reuse the same Cradle-owned binding APIs as the CLI. Browser tests remain out of scope because the requested work is primarily the plugin/projection foundation and the repository instructions discourage unnecessary frontend tests unless requested.
  Date/Author: 2026-06-08 / Codex.

- Decision: Repository synchronization is workspace-bound and Cradle-owned.
  Rationale: The plugin can know how to read GitHub, but it must not decide which Cradle workspace receives which repository. A Cradle-owned binding table records that `owner/repo` should appear in `workspaceId`, preserving namespace ownership and giving the user a concrete "start syncing this repo into this workspace" operation.
  Date/Author: 2026-06-08 / Codex.

- Decision: The first version is manual-refresh by default, with optional low-frequency scheduled refresh per binding.
  Rationale: Automatic background polling across many repositories can burn GitHub rate limit quickly. Manual refresh gives deterministic user control. Scheduled refresh should be opt-in, workspace-scoped, and clamped to a conservative minimum interval.
  Date/Author: 2026-06-08 / Codex.

- Decision: Use conditional GitHub requests, per-binding cursors, and a refresh lease to reduce rate-limit pressure.
  Rationale: GitHub supports `ETag` and `If-None-Match`; unchanged repositories can return `304 Not Modified` with far less payload. A per-binding cursor avoids losing rate-limit state when multiple workspaces or agents request refresh. A lease prevents concurrent refreshes for the same binding from making duplicate API calls.
  Date/Author: 2026-06-08 / Codex.

- Decision: Coalesce GitHub fetches by source and repository before projecting to workspace bindings.
  Rationale: Multiple workspaces may bind the same `owner/repo`. Fetching GitHub once per workspace would waste quota. The refresh coordinator should acquire a repository-level lease keyed by `sourceKey + repositoryOwner + repositoryName`, fetch one snapshot, then project that snapshot into each requested workspace binding while preserving each binding's local status overlay.
  Date/Author: 2026-06-08 / Codex.

- Decision: Add a host-owned binding update route for Settings controls.
  Rationale: Users need to enable/disable a binding and opt into/out of hourly scheduled refresh without deleting and recreating the binding. These fields belong to Cradle's workspace binding lifecycle, not to the plugin. The service clamps `refreshIntervalSeconds` to the one-hour minimum.
  Date/Author: 2026-06-08 / Codex.

- Decision: Implement Kanban external cards as a narrow board union in the web read path.
  Rationale: GitHub issues must not become normal `kanban_issues`, but the current Kanban card/list components already render issue-like fields. Mapping `external_issue_items` into a tagged read-only board card lets the board reuse layout while routing detail and mutations through external-item-only APIs.
  Date/Author: 2026-06-08 / Codex.

## Outcomes & Retrospective

The implementation is complete for this plan. The SDK, DB schema, server projection module, first-party GitHub plugin, generated clients, Settings entry, and Kanban read-only projection are implemented and validated. GitHub Issues are stored as `external_issue_items`, not normal `kanban_issues`; Kanban shows them as visually marked external cards; the detail view is read-only except for status; Settings provides explicit workspace repository binding, refresh, enable/disable, hourly schedule toggle, and delete controls.

## Context and Orientation

The repository root is `/Users/wibus/dev/Cradle`. The server application lives in `apps/server`. The plugin SDK lives in `packages/plugin-sdk`. Database schema lives in `packages/db/src/schema`, with SQL migrations under `packages/db/drizzle`. First-party plugins live under `plugins/*` and are included in the workspace by `pnpm-workspace.yaml`.

The current server plugin context is defined in `packages/plugin-sdk/src/server.ts`. It exposes namespaced capabilities such as `ctx.routes`, `ctx.mcp`, `ctx.skills`, `ctx.providers.externalSources`, `ctx.runtimes`, `ctx.storage`, `ctx.hooks`, and `ctx.events`. The existing external provider source contract is under `ctx.providers.externalSources`; a plugin registers a reader and the host later calls `readSnapshot()`.

The server plugin host lives in `apps/server/src/plugins/`. `external-provider-source-registry.ts` stores currently registered provider source readers in memory. It derives a stable source key by hashing the plugin owner and source id. `context.ts` injects the registration API into each plugin's activation context. `loader.ts` resets registries during plugin reload and deactivation. `storage.ts` provides plugin-scoped KV using `plugin_storage_entries`.

The external provider source projection module lives in `apps/server/src/modules/external-provider-sources/`. Its README states the ownership rule clearly: plugins do not render provider UI and do not write Cradle profile tables directly; they register sources through the SDK, while this module writes Cradle-owned external-source state plus runtime target state. The GitHub issue source should follow this same pattern for issues.

The Issue module lives in `apps/server/src/modules/issue/`. It owns normal workspace-scoped Cradle issue semantics. `model.ts` defines TypeBox schemas for requests and responses. `service.ts` validates inputs, resolves statuses, creates and updates issues, records field changes, handles actor provenance, and exposes search/comment/relation/context-ref behavior. `index.ts` owns HTTP routes and `x-cradle-cli` metadata for generated CLI commands. The GitHub projection module must not call normal issue creation for GitHub records. Instead, the Kanban read path should learn how to include external issue projection cards beside normal issue cards.

In this plan, "external issue source" means a plugin-provided reader that returns issue-shaped data from an external product such as GitHub. "Snapshot" means one read of that external source at a specific time. "Projection" means Cradle-owned code taking a snapshot and writing Cradle-owned external issue tables. "External issue item" means one external issue as shown on the Kanban board. It is not a normal Cradle issue row. "Status overlay" means the one local field Cradle stores for the external issue so a user can move the card between Kanban columns without editing GitHub-owned fields.

## Plan of Work

Milestone 1 adds the SDK and host registry. Extend `packages/plugin-sdk/src/server.ts` with a new issue-owned capability namespace. Prefer `ctx.issues.externalSources.register(...)` so ownership is visible in the API. Define `ExternalIssueSource`, `ExternalIssueSourceReadContext`, `ExternalIssueSourceSnapshot`, `ExternalIssueRecord`, and warning/capability types. Keep the shape narrow: source metadata, warnings, repository inventory, and issue records. Do not add UI contribution types.

Add `apps/server/src/plugins/external-issue-source-registry.ts`, modeled on `external-provider-source-registry.ts`. It should derive `sourceKey` from plugin package identity and source id using the same stable hash pattern. It should register a plugin capability record with type `external-issue-source`, enforce non-empty source id and label, reject duplicate source ids for one owner, and unregister capability records on dispose. Update `apps/server/src/plugins/context.ts` to expose `ctx.issues.externalSources.register(source)`. Update `apps/server/src/plugins/loader.ts` to reset the issue source registry along with the provider source registry.

Milestone 2 adds Cradle-owned source/binding/cursor/item schema. Create `packages/db/src/schema/external-issues.ts` and export it from `packages/db/src/schema/index.ts`. Add SQL migration under `packages/db/drizzle` using the next migration number. The schema should include `external_issue_sources`, `external_issue_source_bindings`, `external_issue_repository_cursors`, and `external_issue_items`.

`external_issue_sources` stores one row per plugin source. The primary key is the derived `sourceKey`. It includes `pluginName`, `sourceId`, `label`, `description`, `enabled`, `registrationStatus`, `capabilitiesJson`, `inventoryJson`, `warningsJson`, `lastSyncStatus`, `lastSyncMessage`, `lastSyncError`, `lastSyncAt`, and timestamps. `registrationStatus` should include at least `registered` and `unregistered`.

`external_issue_source_bindings` stores the user's decision to show one external repository in one Cradle workspace. It includes `id`, `workspaceId`, `sourceKey`, `repositoryOwner`, `repositoryName`, `enabled`, `scheduleEnabled`, `refreshIntervalSeconds`, `lastRefreshStatus`, `lastRefreshMessage`, `lastRefreshError`, `lastRefreshAt`, `nextRefreshAfter`, and timestamps. Add a unique index on `(workspaceId, sourceKey, repositoryOwner, repositoryName)`. Clamp `refreshIntervalSeconds` to a conservative minimum such as 3600 seconds in service code. Manual refresh may ignore `nextRefreshAfter` only when the caller passes an explicit `force` flag and the shared repository cursor is not currently rate-limited.

`external_issue_repository_cursors` stores source/repository fetch state shared across workspace bindings. It includes `id`, `sourceKey`, `repositoryOwner`, `repositoryName`, `etag`, `cursorJson`, `lastFetchStatus`, `lastFetchMessage`, `lastFetchError`, `lastFetchedAt`, `nextFetchAfter`, `rateLimitResetAt`, `rateLimitRemaining`, and timestamps. Add a unique index on `(sourceKey, repositoryOwner, repositoryName)`. This table prevents duplicate GitHub calls when several workspace bindings use the same repository.

`external_issue_items` stores durable board projection rows and source-owned issue facts. It includes `id`, `bindingId`, `workspaceId`, `statusId`, `sourceKey`, `externalId`, `externalKey`, `externalUrl`, `repositoryOwner`, `repositoryName`, `number`, `title`, `body`, `sourceState`, `labelsJson`, `assigneesJson`, `milestone`, `sourceCreatedAt`, `sourceUpdatedAt`, `sourceClosedAt`, `syncStatus`, `fingerprint`, `metadataJson`, `warningsJson`, `lastSeenAt`, and timestamps. It must not include a `kanban_issues.id` foreign key because this is not a Cradle issue. Add unique indexes on `(workspaceId, sourceKey, externalId)` and `(workspaceId, sourceKey, externalKey)`, plus an index on `bindingId`. `externalId` should use GitHub `node_id` when available; `externalKey` should be stable text such as `owner/repo#123`.

This schema is intentionally Cradle-owned. Plugin storage remains available for plugin-private cursors or cache values, but the projection module must not depend on plugin storage for dedupe.

Milestone 3 adds the projection service and routes. Create a new server module at `apps/server/src/modules/external-issue-sources/` with `README.md`, `model.ts`, `service.ts`, and `index.ts`. The README must state that this module owns host-side persistence of plugin-provided issue source snapshots and their read-only projection into Kanban. The routes should live under `/external-issue-sources`, not `/plugins/:routeSegment`, because this is a host-owned capability.

Expose routes for listing sources, binding repositories to workspaces, refreshing one binding or source for a workspace, listing external issue items, and updating the local status overlay. Suggested routes are:

- `GET /external-issue-sources`
- `GET /external-issue-sources/bindings`
- `POST /external-issue-sources/:sourceKey/bindings`
- `DELETE /external-issue-sources/bindings/:bindingId`
- `POST /external-issue-sources/bindings/:bindingId/refresh`
- `POST /external-issue-sources/:sourceKey/refresh`
- `GET /external-issue-sources/items`
- `PATCH /external-issue-sources/items/:id/status`

Add `x-cradle-cli` metadata for stable agent-facing commands such as `external-issue-source list`, `external-issue-source bind`, `external-issue-source binding list`, `external-issue-source refresh`, `external-issue-source item list`, and `external-issue-source item move`. Do not expose plugin-private GitHub token configuration as CLI output.

Starting sync is an explicit Cradle operation. The user or agent creates a binding by passing `workspaceId`, `repositoryOwner`, and `repositoryName` to `POST /external-issue-sources/:sourceKey/bindings` or the generated CLI command. Binding creation should not immediately run an unbounded sync unless the caller passes `refreshNow: true`; otherwise it records the binding and sets `nextRefreshAfter` so a later manual or scheduled refresh can run. The plugin should never choose the Cradle workspace to write into. The workspace belongs to Cradle and is supplied by the user, API caller, or CLI command.

Refreshes operate over bindings, not over a global environment repository list. A binding refresh supplies exactly one repository and its stored shared cursor/ETag to the plugin. A source refresh for a workspace iterates that workspace's enabled bindings for the source and applies the same per-binding limits. Do not refresh repositories that have not been explicitly bound to the workspace. When multiple selected bindings point at the same `sourceKey + owner/repo`, fetch the GitHub snapshot once, update the shared repository cursor, and project the result into every selected binding.

The default update frequency is no automatic polling. Manual refresh is always available unless the repository is currently rate-limited or already refreshing. Scheduled refresh is opt-in per binding and must use a conservative minimum interval, such as one hour. The service should skip scheduled bindings whose `nextRefreshAfter` is in the future. If GitHub reports low or exhausted rate limit, record `rateLimitRemaining` and `rateLimitResetAt` on the shared repository cursor, return a clear result, and set `nextRefreshAfter` to the reset time for affected bindings. A manual forced refresh must still respect an active rate-limit reset unless the implementation has strong evidence that the request will be conditional and cheap.

The projection algorithm should run in a transaction after the plugin returns a snapshot. It should call the registered source's `readSnapshot()` with an abort signal, logger, shared config, repository owner/name, previous ETag, and previous cursor. It should validate the snapshot with zod or TypeBox-derived runtime checks. If the source returns `notModified`, update the shared repository cursor and binding timestamps/rate-limit fields but do not mark absent items missing. For each selected workspace binding and each external issue record, compute a stable fingerprint from source-owned fields such as title, body, state, labels, assignees, milestone, updatedAt, and external URL. Look up an existing `external_issue_items` row by `(workspaceId, sourceKey, externalId)` first, then by `(workspaceId, sourceKey, externalKey)`. If one exists, update source-owned fields and preserve the local `statusId`. If none exists, insert a new external issue item with the workspace's default status or a configured GitHub state to status mapping. Do not insert into `kanban_issues`.

The service must enforce the field ownership policy. GitHub-owned fields are title, body, labels, assignees, milestone, state, number, URL, and timestamps. Cradle-owned local overlay is only `statusId`. Users can move the external issue card between Kanban columns, but cannot edit title, description, labels, assignees, comments, relations, context refs, due dates, delegation, or other normal issue properties. Labels shown on the card and detail view are direct GitHub label mappings.

When a registered source returns a full successful repository snapshot and no longer includes an external issue that was previously seen for that binding, mark the item `syncStatus = missing` and keep the row so its local status overlay and provenance remain inspectable. Do not mark missing on partial failures, rate-limit responses, or `304 Not Modified`. If the GitHub record later returns, mark it active again and update source fields. When plugin reload completes, reconcile persisted `external_issue_sources` against currently registered issue source keys: rows not registered become `registrationStatus = unregistered`. This stops refresh but does not delete external issue items. When the same plugin identity and source id register again, the same `sourceKey` reconnects to existing items.

Milestone 3 also updates the Kanban read model. Inspect `apps/server/src/modules/issue/index.ts`, `apps/server/src/modules/issue/service.ts`, and `apps/web/src/features/kanban/` to find the current issue list contract. Add a Cradle-owned read projection that returns normal Cradle issues and external issue items in one board-shaped response, or add a parallel external item list consumed by Kanban. The UI must visually mark GitHub cards as external, show GitHub labels as labels, and route the detail panel to a read-only external issue view. The only enabled mutation in that view is status change.

Milestone 3 also adds a Settings entry for synchronization. Inspect `apps/web/src/features/settings/` and the workspace settings/navigation code to find the existing settings section structure. Add a quiet, form-based integration panel owned by Cradle, not by the plugin. The panel should list registered external issue sources, list bindings for the selected or current workspace, and let the user add a binding by entering `owner/repo`. Each binding row should show repository, source, enabled state, schedule state, interval, last refresh status, last refresh time, rate-limit remaining/reset when present, and item counts if the API exposes them. Row actions should include refresh now, enable/disable binding, toggle scheduled sync, and delete binding. The add flow may include a `Refresh now` checkbox. Use existing design-system components, static Tailwind classes, and `cn()` for conditional classes. Do not let the plugin contribute custom Settings UI.

Milestone 4 adds the first-party GitHub plugin. Create `plugins/github-issues/` with `package.json`, `tsconfig.json`, `vite.config.ts`, `README.md`, and source files. The server entry should register one source with id `github-issues`. The manifest must use `apiVersion: "1"` and declare the runtime capability it registers. Match current first-party plugin manifest conventions by inspecting `plugins/cc-switch/package.json` and `plugins/system-info/package.json`.

The plugin should read configuration from environment variables and shared config. For this first version, support:

- `CRADLE_GITHUB_ISSUES_TOKEN` for a GitHub token. Public repositories may work without it, but private repositories require it.
- `CRADLE_GITHUB_API_BASE_URL` for GitHub Enterprise, defaulting to `https://api.github.com`.
- `CRADLE_GITHUB_ISSUES_MAX_PER_REPO`, defaulting to a conservative value such as `100`.

Use the GitHub REST API with Node `fetch` unless the repository already has an approved GitHub client dependency. Read issue pages for the single repository requested by the binding refresh, excluding pull requests because GitHub's Issues API can return pull request-shaped entries. Use GitHub `node_id` as `externalId`, `owner/repo#number` as `externalKey`, and `html_url` as `externalUrl`. Map GitHub fields into the fixed snapshot shape. Do not persist GitHub tokens in plugin storage.

The plugin must support conditional requests. Accept `etag` from the read context and send it as `If-None-Match` when present. Return `notModified: true` when GitHub responds `304`. Return rate-limit facts from response headers such as `X-RateLimit-Remaining` and `X-RateLimit-Reset` in the snapshot source metadata so the host can update the binding. Avoid making one request per issue; use list endpoints with pagination and stop at `CRADLE_GITHUB_ISSUES_MAX_PER_REPO`.

Add plugin-local tests under `plugins/github-issues/src/` that mock `fetch` and cover repository parsing, auth header behavior, pagination, pull request filtering, warning generation, and snapshot shape. These are not frontend tests.

Milestone 5 adds server tests. Add focused tests under `apps/server/tests/external-issue-sources.test.ts` or a similarly named file. Use a fixture source registered directly through the new registry rather than calling real GitHub. Cover these behaviors:

1. A source refresh for a workspace inserts `external_issue_items` and does not insert `kanban_issues`.
2. A second refresh with the same external id updates the existing external item and does not create a duplicate.
3. A source refresh that omits a previously seen external issue marks the item `missing` and keeps the external item row.
4. A source registry reset marks persisted sources `unregistered` during reconcile and keeps external items.
5. Re-registering the same plugin identity and source id reuses the same `sourceKey` and reconnects existing items.
6. Updating an external item status succeeds and preserves that status across subsequent GitHub refreshes.
7. Attempts to update title, description, labels, comments, relations, delegation, or context refs on an external item fail with a deterministic read-only error.
8. A conflicting external id or external key reports a deterministic conflict instead of silently creating two board cards.
9. Creating a workspace binding for `owner/repo` enables refresh for only that workspace and repository.
10. Concurrent refresh attempts for the same source/repository use a lease or return an already-running result instead of making duplicate GitHub requests.
11. A `notModified` snapshot updates binding metadata but does not mark existing items missing.
12. A rate-limit response records reset time and prevents scheduled refresh until reset.
13. Two workspace bindings for the same source/repository share one GitHub fetch and then project into both workspaces.

If the Kanban read path currently assumes every card is a normal Cradle issue, add a typed union model rather than forcing external items into the existing `IssueView`. Do not invent a second full issue type with Cradle issue semantics; expose a narrow external card/detail view with only the fields it actually supports.

Milestone 6 updates docs and generated clients. Update `apps/server/src/plugins/README.md` to mention external issue source registry. Update `packages/plugin-sdk/DEVELOPERS.md` with the new `ctx.issues.externalSources` API and a small example. Add `apps/server/src/modules/external-issue-sources/README.md`. Update `apps/web/src/features/settings/README.md` to describe the GitHub Issues sync panel and ownership boundary. Update `plugins/github-issues/README.md` with configuration, token behavior, Settings setup path, CLI setup path, and the no-direct-write boundary. Regenerate CLI if route metadata changes.

## Concrete Steps

Work from `/Users/wibus/dev/Cradle`.

Before editing, inspect the dirty worktree and avoid reverting unrelated user changes:

    git status --short

Read the existing provider source pattern:

    sed -n '1,220p' packages/plugin-sdk/src/server.ts
    sed -n '1,120p' apps/server/src/plugins/external-provider-source-registry.ts
    sed -n '1,220p' apps/server/src/plugins/context.ts
    sed -n '1,220p' packages/db/src/schema/external-sources.ts
    sed -n '1,760p' apps/server/src/modules/external-provider-sources/service.ts

Read the issue owner before writing projection code:

    sed -n '1,260p' apps/server/src/modules/issue/service.ts
    sed -n '1,260p' apps/server/src/modules/issue/model.ts
    sed -n '1,220p' packages/db/src/schema/issue.ts

After adding route metadata, regenerate generated clients and CLI:

    pnpm gen:cli
    pnpm --filter @cradle/cli typecheck
    pnpm --filter @cradle/cli cradle external-issue-source --help

Run focused validation:

    pnpm --filter @cradle/plugin-sdk typecheck
    pnpm --filter @cradle/server exec vitest run tests/external-issue-sources.test.ts
    pnpm --filter @cradle/server exec vitest run src/plugins/loader.test.ts src/plugins/runtime-registry.test.ts
    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    pnpm --filter @cradle/github-issues test
    pnpm --filter @cradle/github-issues typecheck

If the plugin package name differs, replace `@cradle/github-issues` with the actual `name` from `plugins/github-issues/package.json`.

For manual verification with a real repository, set environment variables and start the server:

    export CRADLE_GITHUB_ISSUES_TOKEN=ghp_or_fine_grained_token_if_private
    pnpm dev:server

In another terminal, list sources, bind a repository to a workspace, and refresh the binding with the CLI:

    pnpm --filter @cradle/cli cradle external-issue-source list
    pnpm --filter @cradle/cli cradle external-issue-source bind <sourceKey> --workspace-id <workspaceId> --repository owner/repo
    pnpm --filter @cradle/cli cradle external-issue-source binding list --workspace-id <workspaceId>
    pnpm --filter @cradle/cli cradle external-issue-source refresh --binding-id <bindingId>
    pnpm --filter @cradle/cli cradle external-issue-source item list --workspace-id <workspaceId> --json id,externalKey,statusId,syncStatus

Expected behavior: the source list includes `github-issues`; binding list includes the selected `owner/repo`; refresh reports records seen, records projected, records missing, not-modified status if applicable, rate-limit remaining/reset facts, and source status; external item list includes the GitHub issue titles, direct GitHub labels, local status ids, and stable external keys such as `owner/repo#123`. A normal `cradle issue list` command must not show these items unless the command is explicitly upgraded to return a union of native and external cards.

Verify the Settings path manually without browser automation. Start the web app through the repository's normal dev workflow, open Settings, navigate to the GitHub Issues or External Issue Sources section, select the target workspace, add `owner/repo`, optionally check `Refresh now`, and confirm the binding appears with last refresh status and rate-limit metadata. Trigger `Refresh now` from the row action and confirm the same item list output appears from the CLI. Do not add frontend tests unless the existing Settings test harness already makes this cheap and local.

To verify reinstall/reconnect behavior without marketplace install, temporarily disable the plugin source registration or run a test that calls the registry reset/reconcile path. The expected result is that the source row becomes `unregistered` and external issue items remain. Re-enable the source and refresh again. The expected result is that the same external keys reconnect and no duplicate external cards are created.

## Validation and Acceptance

Acceptance is behavioral. A first-party server plugin named `github-issues` can register an external issue source. `GET /external-issue-sources` or the generated CLI list command shows the source with its plugin owner, source id, registration status, last sync status, and last sync timestamp.

A user can start synchronization for one repository in one workspace with a single explicit command:

    cradle external-issue-source bind <sourceKey> --workspace-id <workspaceId> --repository owner/repo

No GitHub repository is refreshed merely because it appears in an environment variable. Refresh happens for workspace bindings only.

A user can also start synchronization from Settings. The Settings panel lists available external issue sources and workspace bindings, accepts `owner/repo`, creates a binding for the selected workspace, and optionally runs the first refresh. The Settings panel shows last refresh status and rate-limit reset information so the user can understand why a refresh is skipped.

Refreshing the GitHub source for a workspace creates external issue items and creates no `kanban_issues` rows. Running the same refresh twice does not create duplicates. Updating the fixture or mocked GitHub title updates the existing external item and changes the fingerprint. Removing an external issue from the snapshot marks the item `missing` and keeps the row.

Resetting or unloading the plugin registry marks the persisted source `unregistered`, but does not delete `external_issue_items`. Re-registering the same plugin identity and source id yields the same `sourceKey`, and the next refresh reconnects to existing items.

In the Kanban board, GitHub cards are visually distinguishable from native Cradle issue cards. They show GitHub labels exactly as mapped from GitHub. Opening a GitHub card shows a read-only detail view. Title, body, labels, comments, relations, due date, context refs, delegation, and assignee controls are disabled or absent. Moving the card to another Kanban status succeeds and persists locally across refresh.

Rate-limit behavior is visible and protective. If GitHub returns `304 Not Modified`, no item is marked missing. If GitHub returns rate-limit exhaustion or very low remaining quota, the shared repository cursor records `rateLimitResetAt`, scheduled refresh skips affected bindings until reset, and manual refresh returns a clear error unless explicitly forced and still safe. Two refresh calls for the same source/repository do not issue two GitHub fetch sequences concurrently.

The plugin never directly imports the database, issue service, or Drizzle schema. A source search should show no direct issue writes from `plugins/github-issues`:

    rg -n "kanban_issues|issues\\)|issueExternalRefs|@cradle/db|modules/issue" plugins/github-issues

Expected output is empty, except for README prose if it names the boundary.

Actual validation on 2026-06-08 03:09 CST:

    pnpm gen:cli
    -> Generated 220 CLI commands

    pnpm generate:web
    -> GitHub Issues plugin activated
    -> @hey-api/openapi-ts Done, output in ./apps/web/src/api-gen

    pnpm --filter @cradle/web typecheck
    -> tsc --noEmit passed

    pnpm --filter @cradle/cli typecheck
    -> tsc --noEmit passed

    pnpm --filter @cradle/cli cradle external-issue-source binding update --help
    -> command loads and exposes --enabled, --no-enabled, --schedule-enabled, --no-schedule-enabled, and --refresh-interval-seconds

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    -> passed

    pnpm --filter @cradle/plugin-sdk typecheck
    -> tsc --noEmit -p tsconfig.json passed

    pnpm --filter @cradle/server exec vitest run tests/external-issue-sources.test.ts --reporter=dot
    -> 1 test file passed, 2 tests passed

    pnpm --filter @cradle/github-issues test
    -> 1 test file passed, 5 tests passed

    pnpm --filter @cradle/github-issues typecheck
    -> tsc --noEmit passed

    pnpm --filter @cradle/github-issues build
    -> dist/server.mjs built

    rg -n "kanban_issues|issues\)|issueExternalRefs|@cradle/db|modules/issue" plugins/github-issues || true
    -> only plugin tests mentioning snapshot.issues; no DB or issue module imports.

Server tests prove the projection behavior without real GitHub credentials. Plugin-local tests prove the GitHub REST mapping behavior with mocked `fetch`. No browser automation is required for this plan.

## Idempotence and Recovery

All refreshes must be idempotent. The unique constraints on `(workspaceId, sourceKey, externalId)` and `(workspaceId, sourceKey, externalKey)` prevent duplicate external items. The projection service should use transactions so a failed refresh does not leave a partial external item. If a transaction fails after reading GitHub but before writing rows, rerunning the same refresh should produce the same final state.

If a plugin is removed, do not delete external issue items. Mark the source unregistered and stop refresh. If a plugin is reinstalled with the same package identity and source id, the derived source key must be the same, allowing existing items to reconnect.

If a GitHub issue changes in ways that conflict with local board state, the first version should prefer a simple deterministic policy over hidden merges. Source-owned fields are overwritten by refresh; the Cradle-owned status overlay is preserved. Record any later expansion of editable fields in the Decision Log before implementation.

Refresh scheduling is idempotent and conservative. Manual refresh can run any time unless an active rate-limit reset or refresh lease blocks it. Scheduled refresh only runs for bindings with `scheduleEnabled = true`, `enabled = true`, a registered source, and `nextRefreshAfter <= now`. The service should update `nextRefreshAfter` after every attempted scheduled refresh, even on errors, so a broken token or repository does not create a tight retry loop.

If a migration is added, keep it additive. Do not drop or rewrite existing issue tables. If a migration fails locally, fix the migration and rerun the development database migration flow according to `packages/db/drizzle/README.md`; do not manually patch production-like SQLite files.

## Artifacts and Notes

The existing provider source pattern is the main model to copy. It already shows stable source key derivation:

    deriveExternalProviderSourceKey(owner, sourceId)
    -> sha256(owner + "\\0" + sourceId).slice(0, 24)

The GitHub issue source should use the same idea with a new prefix, for example:

    external_issue_source_<24 hex chars>

The GitHub external key should be stable and human-readable:

    owner/repo#123

The GitHub external id should prefer GitHub `node_id`, because it is stable across repository renames:

    I_kwDOExampleIssueNodeId

Example snapshot shape, written as indented TypeScript for readability:

    {
      source: { status: 'ok', message: 'Fetched 42 GitHub issues' },
      inventory: { repositories: 2, issues: 42 },
      issues: [
        {
          externalId: 'I_kwDOExampleIssueNodeId',
          externalKey: 'cradle/cradle#123',
          externalUrl: 'https://github.com/cradle/cradle/issues/123',
          repository: { owner: 'cradle', name: 'cradle' },
          number: 123,
          title: 'Fix issue sync',
          body: 'Issue body text',
          state: 'open',
          labels: ['bug'],
          assignees: ['wibus'],
          updatedAt: '2026-06-08T01:00:00Z'
        }
      ],
      warnings: []
    }

Do not include full GitHub API responses in persisted metadata. Persist only normalized fields that Cradle needs for display, diffing, dedupe, status overlay, and provenance.

## Interfaces and Dependencies

In `packages/plugin-sdk/src/server.ts`, add issue source APIs under `ServerPluginContext`:

    export interface ServerPluginContext {
      issues: ServerPluginIssueRegistries
      ...
    }

    export interface ServerPluginIssueRegistries {
      externalSources: ExternalIssueSourceRegistry
    }

    export interface ExternalIssueSourceRegistry {
      register: (source: ExternalIssueSource) => Disposable
    }

    export interface ExternalIssueSource {
      id: string
      label: string
      description?: string
      capabilities?: ExternalIssueSourceCapabilities
      readSnapshot: (ctx: ExternalIssueSourceReadContext) => Promise<ExternalIssueSourceSnapshot>
    }

    export interface ExternalIssueSourceReadContext {
      signal: AbortSignal
      logger: Logger
      sharedConfig: ReadonlyMap<string, string>
      workspaceId: string
      repository: {
        owner: string
        name: string
      }
      etag?: string | null
      cursor?: Record<string, unknown> | null
    }

    export interface ExternalIssueSourceSnapshot {
      source: {
        status: 'ok' | 'warning' | 'error'
        message?: string
        observedAt?: string
        notModified?: boolean
        etag?: string
        cursor?: Record<string, unknown>
        rateLimit?: {
          remaining?: number
          resetAt?: number
        }
      }
      issues: ExternalIssueRecord[]
      inventory?: Record<string, unknown>
      warnings?: ExternalIssueWarning[]
    }

    export interface ExternalIssueRecord {
      externalId: string
      externalKey: string
      externalUrl?: string
      repository: {
        owner: string
        name: string
      }
      number: number
      title: string
      body?: string | null
      state: 'open' | 'closed'
      labels?: string[]
      assignees?: string[]
      milestone?: string | null
      createdAt?: string
      updatedAt?: string
      closedAt?: string | null
      metadata?: Record<string, unknown>
      warnings?: ExternalIssueWarning[]
    }

    export interface ExternalIssueWarning {
      code: string
      message: string
      severity: 'info' | 'warning' | 'error'
    }

In `apps/server/src/plugins/external-issue-source-registry.ts`, expose:

    deriveExternalIssueSourceKey(owner: string, sourceId: string): string
    registerExternalIssueSource(owner: string, source: ExternalIssueSource): Disposable
    listExternalIssueSources(): RegisteredExternalIssueSource[]
    getExternalIssueSource(sourceKey: string): RegisteredExternalIssueSource | null
    resetExternalIssueSourceRegistry(): void

In `apps/server/src/modules/external-issue-sources/service.ts`, expose:

    listExternalIssueSources(): ExternalIssueSourceView[]
    createExternalIssueSourceBinding(input: {
      workspaceId: string
      sourceKey: string
      repositoryOwner: string
      repositoryName: string
      scheduleEnabled?: boolean
      refreshIntervalSeconds?: number
      refreshNow?: boolean
    }): Promise<ExternalIssueSourceBindingView>
    listExternalIssueSourceBindings(input?: { workspaceId?: string; sourceKey?: string }): ExternalIssueSourceBindingView[]
    deleteExternalIssueSourceBinding(bindingId: string): { ok: true }
    refreshExternalIssueSourceBinding(bindingId: string, input?: { force?: boolean }): Promise<ExternalIssueRefreshResult>
    refreshExternalIssueSource(sourceKey: string, input: { workspaceId: string; force?: boolean }): Promise<ExternalIssueRefreshResult[]>
    refreshDueExternalIssueSourceBindings(input?: { now?: number }): Promise<ExternalIssueRefreshResult[]>
    listExternalIssueItems(input?: { workspaceId?: string; sourceKey?: string; syncStatus?: string }): ExternalIssueItemView[]
    updateExternalIssueItemStatus(itemId: string, input: { statusId: string }): ExternalIssueItemView
    reconcileExternalIssueSourceRegistrations(): void

The projection service depends on:

- `@cradle/plugin-sdk/server` for source types.
- `apps/server/src/plugins/external-issue-source-registry.ts` for registered source readers.
- `apps/server/src/modules/issue/service.ts` only for workspace status resolution and board read integration, not for creating GitHub-backed issue rows.
- `@cradle/db` Drizzle schema for Cradle-owned source/item tables.
- zod or TypeBox for runtime snapshot validation, following the existing external provider source service pattern.

The Settings UI depends on generated server client APIs or the existing app query layer, not plugin routes. It should live under `apps/web/src/features/settings/` or the existing workspace settings feature area, whichever currently owns integration settings. It should call the host-owned `/external-issue-sources` routes, use existing design-system components, and avoid plugin-provided React components.

Revision note 2026-06-08: Initial plan created after inspecting plugin storage, external provider source projection, issue ownership, and the current plugin registry lifecycle. The plan scopes out marketplace install and focuses on the first-party GitHub Issues plugin plus Cradle-owned issue projection.

Revision note 2026-06-08: Updated after product clarification that GitHub issues must be mapped into Kanban as read-only external items, not created as normal Cradle issues. The only local editable field is status; labels and all other issue content are mapped from GitHub.

Revision note 2026-06-08: Added explicit workspace repository bindings and a rate-limit-safe synchronization policy. Default sync is manual; scheduled refresh is opt-in per binding and must use ETag, shared repository cursor storage, rate-limit reset handling, and source/repository refresh leases so multiple workspace bindings do not duplicate GitHub fetches.

Revision note 2026-06-08: Added a Cradle-owned Settings panel for starting and managing GitHub issue synchronization. The Settings UI creates the same workspace repository bindings as the CLI and does not let plugins contribute custom Settings UI.

Revision note 2026-06-08: Updated progress after implementation. Added the binding update route decision, Kanban tagged-union decision, and discoveries from OpenAPI generation and Settings requirements.

Revision note 2026-06-08: Marked the plan complete after final validation. Added the validation transcript and final outcome summary.
