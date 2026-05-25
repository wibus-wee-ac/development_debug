# External Provider Sources

This module owns host-side persistence of plugin-provided provider source snapshots and external runtime targets.

- `index.ts`: HTTP routes for listing sources, refreshing sources, listing source records, and reading external runtime target metadata.
- `local-agent-config-source.ts`: Onboarding utility that reads allowlisted local Claude and Codex config files into an `ExternalProviderSourceSnapshot`; it is intentionally not registered on startup yet.
- `model.ts`: Elysia response schemas for the fixed external provider source API.
- `service.ts`: Snapshot validation, source persistence, runtime target projection, secret upsert, missing-record handling, runtime preference preservation, and view serialization.

Plugins do not render Provider UI and do not write Cradle profile tables directly. They register external provider sources through `@cradle/plugin-sdk/server`; this module reads the registered sources and writes Cradle-owned external-source state plus runtime-target state. Manual profiles remain user-authored entries in `agent_profiles`; external records stay in external-source-owned tables and are consumed through provider-target references. Source refreshes replace source-owned config fields while preserving Cradle-owned runtime preferences such as model visibility.
