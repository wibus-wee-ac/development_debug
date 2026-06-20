# provider-targets

Provider-target resolver and Cradle-owned runtime preference API.

- `index.ts`: HTTP routes for reading and updating provider-target model settings, Claude Agent model matrix defaults, model visibility, custom model IDs, and provider-target scoped Codex account diagnostics.
- `model.ts`: Elysia request and response schemas for provider-target preference, Claude Agent matrix, and diagnostics routes.
- `service.ts`: Resolves a runtime provider target into normalized config, credential, and ownership-aware metadata for manual profiles and external provider records; writes Cradle-owned `connection_config_json.claudeAgent.modelAliases`; disables bound agents when a provider target becomes disabled.

Manual profiles and external runtime targets both implement the provider-target contract. External source records remain source-owned; model visibility, custom model IDs, and Claude Agent haiku / sonnet / opus model aliases are Cradle-owned runtime preferences written to the runtime target namespace. Model registry mappings are global and owned by `modules/model-registry`, not by any target.
Provider target availability is a launch prerequisite for provider-backed agents. Turning a provider target off preserves the target record and its preferences, but forces every bound agent to disabled until the user reselects or re-enables an available provider target.
Deleting a provider target detaches chat-owned historical rows from the removed target instead of deleting sessions or messages. Bound agents are retained, disabled, and detached from the missing target so their identities can be repaired without losing chat attribution.
Codex account diagnostics are exposed as provider-target scoped Settings APIs under `/provider-targets/:providerTargetId/codex/*`. The routes read Codex-native account usage and rate-limit state only after an explicit user action in Settings. Unsupported targets return an unsupported diagnostics response without starting Codex app-server, while reset-credit consumption is a separate POST action with an idempotency key.
