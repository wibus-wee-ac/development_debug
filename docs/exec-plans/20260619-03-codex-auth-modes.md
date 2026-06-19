# Codex Personal Access Token and Bedrock Auth Modes

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained: a contributor who has only this repository and this file should be able to understand and implement the Codex auth-mode expansion without relying on prior chat history.

## Purpose / Big Picture

Codex app-server now exposes native auth modes named `personalAccessToken` and `bedrockApiKey`. Cradle already supports ordinary API-key auth and ChatGPT OAuth token auth for Codex, but its current resolver treats every non-ChatGPT secret as an API key. That is no longer correct. After this work, a user can configure a Codex provider target with one of four explicit auth choices: OpenAI-compatible API key, ChatGPT Login, Codex Personal Access Token, or AWS Bedrock API Key. Each choice is stored under Cradle's provider-target and secret namespaces, projected into Codex app-server using the matching Codex auth mode, and verified without guessing from `baseUrl`, model names, token prefixes, or secret payload shape.

This is a one-shot migration, not a staged rollout. Do not call the work complete after only PAT support. The complete outcome is that both `personalAccessToken` and `bedrockApiKey` are available end-to-end in server config, secret persistence, provider-target normalization, Codex app-server process options, web provider setup and editing UI, and tests. If the installed Codex runtime does not expose a concrete way to pass PAT or Bedrock credentials after the protocol/runtime sync, upgrade or regenerate the runtime first and record the missing upstream contract in this document; do not ship a Cradle-side heuristic or a hidden partial Bedrock mode.

The user-visible proof is simple. In the provider UI, a Codex provider can be saved with Personal Access Token auth and can start a Codex chat without setting `CRADLE_CODEX_API_KEY`, `CODEX_API_KEY`, or `OPENAI_API_KEY`. The same UI can save a Codex provider with Bedrock auth, including non-secret Bedrock settings such as region, and can start a Codex chat whose app-server auth status reports `bedrockApiKey` or whose account projection reports `amazonBedrock`. Existing API-key and ChatGPT Login providers continue to work through their existing native paths.

## Progress

- [x] (2026-06-19T04:40Z) Read the ExecPlan rules and confirmed the non-negotiables: the plan must be self-contained, living, novice-friendly, concrete about commands and files, and independently verifiable.
- [x] (2026-06-19T04:40Z) Created the plan file at `docs/exec-plans/20260619-03-codex-auth-modes.md`.
- [x] (2026-06-19T04:40Z) Inspected the current Codex auth config path in `apps/server/src/modules/provider-contracts/provider-base.ts`, `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts`, and `apps/server/src/modules/chat-runtime-providers/codex/app-server/chatgpt-auth.ts`.
- [x] (2026-06-19T04:40Z) Confirmed the secret store already has an explicit `kind` column and API field in `apps/server/src/modules/secrets/service.ts` and `apps/server/src/modules/secrets/model.ts`.
- [x] (2026-06-19T04:55Z) Revised this plan from a PAT-first/Bedrock-later plan into one complete migration that implements both new Codex auth modes end-to-end.
- [x] (2026-06-19T06:13Z) Confirmed the runtime/protocol state. The desktop sync command failed with a GitHub 403 rate-limit error, but the existing generated protocol already includes the new auth-mode strings; the native contracts were confirmed from the `rust-v0.141.0` Codex source clone under `/tmp/codex-rust-v0.141.0`.
- [x] (2026-06-19T06:13Z) Implemented server-side tagged Codex auth resolution for `apiKey`, `chatgptAuthTokens`, `personalAccessToken`, `bedrockApiKey`, and `none`.
- [x] (2026-06-19T06:13Z) Added secret metadata reading so the Codex resolver uses the encrypted secret row's `kind` instead of parsing or guessing credential type.
- [x] (2026-06-19T06:13Z) Added Codex provider config schema and provider-target normalization for `personalAccessToken` and `bedrockApiKey`, including non-secret `bedrock.region`.
- [x] (2026-06-19T06:13Z) Projected PAT and Bedrock credentials into Codex app-server using native env/config keys, with dedicated non-API-key paths.
- [x] (2026-06-19T06:13Z) Added Codex provider setup and editing UI for API Key, ChatGPT Login, Personal Access Token, and AWS Bedrock API Key.
- [x] (2026-06-19T06:13Z) Added focused server tests for resolver behavior, provider projection, provider-target normalization, host fingerprinting, and ChatGPT regressions. Web UI helper/component files were linted; no broad React component tests were added per repository guidance.
- [x] (2026-06-19T06:13Z) Ran validation commands and recorded results in this plan.

## Surprises & Discoveries

- Observation: `CodexAuthModeSchema` currently allows `apikey`, `chatgpt`, `chatgptAuthTokens`, and `agentIdentity`, but not `personalAccessToken` or `bedrockApiKey`.
  Evidence: `apps/server/src/modules/provider-contracts/provider-base.ts` defines `CodexAuthModeSchema = z.enum(['apikey', 'chatgpt', 'chatgptAuthTokens', 'agentIdentity'])`.

- Observation: Current Codex auth resolution is not tagged. It returns nullable fields `{ apiKey, chatgptAuth }`, so any credential that is not parsed as a ChatGPT OAuth secret becomes an API key.
  Evidence: `resolveCodexAppServerAuth` in `apps/server/src/modules/chat-runtime-providers/codex/app-server/chatgpt-auth.ts` calls `readCodexChatgptAuthCredential`, returns `chatgptAuth` if that parser succeeds, and otherwise returns `{ apiKey: secret, chatgptAuth: null }`.

- Observation: The secret store already records an explicit secret `kind`, so PAT and Bedrock do not need a database migration.
  Evidence: `apps/server/src/modules/secrets/service.ts` accepts `SaveSecretInput { kind, label, secret }`, writes `kind` into `agentCredentials`, and `apps/server/src/modules/secrets/model.ts` exposes `kind` on save/list API models.

- Observation: The current secret read helper loses the `kind` value.
  Evidence: `apps/server/src/modules/secrets/service.ts` exports `readSecret(id): string`, which decrypts and returns only plaintext. It does not return the secret row's `kind` or `label`.

- Observation: Provider-target normalization would currently downgrade PAT and Bedrock credentials to API-key auth.
  Evidence: `resolveCredentialAuthMode` in `apps/server/src/modules/provider-targets/service.ts` returns `chatgptAuthTokens` only for `credential.kind === 'chatgpt-auth'`; every other credential kind becomes `apikey`.

- Observation: Current OpenAI-compatible Codex config projection only adds `env_key: CRADLE_CODEX_API_KEY` for `apikey` mode.
  Evidence: `buildCodexExternalModelProviderConfig` in `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts` conditionally includes `env_key` only when `authMode === 'apikey'`.

- Observation: The generated protocol includes the new auth-mode strings but does not include `personalAccessToken` or `bedrockApiKey` as `account/login/start` parameter variants.
  Evidence: `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/AuthMode.ts` exports `"personalAccessToken"` and `"bedrockApiKey"`, while `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/v2/LoginAccountParams.ts` only supports `apiKey`, `chatgpt`, `chatgptDeviceCode`, and `chatgptAuthTokens`.

- Observation: The generated account projection already has a Bedrock account shape.
  Evidence: `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/v2/Account.ts` is a union of `apiKey`, `chatgpt`, and `amazonBedrock`.

- Observation: The current desktop package sync script is not named plain `sync`.
  Evidence: `apps/desktop/package.json` currently defines `sync:codex-runtime` and `sync:codex-runtime:all`; it does not define `sync`.

- Observation: `pnpm --filter @cradle/desktop sync:codex-runtime` and the server protocol-generation command that invokes it were blocked by GitHub API rate limiting.
  Evidence: The sync command failed with HTTP 403 from GitHub. The existing vendored runtime manifest still reports Codex CLI `0.141.0`, and the generated protocol already contains `personalAccessToken` and `bedrockApiKey`.

- Observation: Codex native PAT and Bedrock credential ingestion is environment/config based, not a new `account/login/start` RPC in the current generated protocol.
  Evidence: In `/tmp/codex-rust-v0.141.0`, native auth storage uses `auth_mode`, `personal_access_token`, and `bedrock_api_key: { api_key, region }`; the runtime reads PAT from `CODEX_ACCESS_TOKEN`, Bedrock bearer from `AWS_BEARER_TOKEN_BEDROCK`, region from `AWS_REGION`, and the built-in provider id is `amazon-bedrock`.

- Observation: The web typecheck is currently blocked by an unrelated diff-review type error outside this auth-mode work.
  Evidence: `pnpm --filter @cradle/web exec tsc --noEmit` fails at `apps/web/src/features/diff-review/review-detail/guide-view.tsx(506,43)` because an object is passed where `CodeViewOptionCallback<ThreadAnnotation, "onGutterUtilityClick">` is expected. ESLint passes for the touched web files.

## Decision Log

- Decision: Implement `personalAccessToken` and `bedrockApiKey` in one cohesive migration.
  Rationale: A PAT-only implementation would leave the same API-key fallback problem alive for Bedrock and would create a second auth-boundary refactor later. The protocol already exposes both modes, and Cradle should update its auth ownership model once.
  Date/Author: 2026-06-19 / Codex

- Decision: Treat Codex auth mode as Codex provider configuration owned by Cradle's provider-target namespace.
  Rationale: The user chooses how a Codex provider target authenticates. The non-secret selection belongs in that target's `configJson`, not in a global agent identity namespace or another product's config namespace.
  Date/Author: 2026-06-19 / Codex

- Decision: Treat credential type as secret metadata owned by Cradle's secret namespace.
  Rationale: Cradle already owns encrypted secret lifecycle and stores `kind` on each row. The resolver should read that metadata directly rather than guessing from payload shape, token prefix, `baseUrl`, or model name.
  Date/Author: 2026-06-19 / Codex

- Decision: Use explicit secret kinds `codex-personal-access-token` and `codex-bedrock-api-key`.
  Rationale: Existing provider-kind secret kinds such as `codex` or `openai-compatible` are too broad. New kinds let UI, diagnostics, resolver tests, and future migrations distinguish PAT from Bedrock and from ordinary OpenAI-compatible API keys.
  Date/Author: 2026-06-19 / Codex

- Decision: Replace the nullable auth pair with a tagged union.
  Rationale: Nullable pairs make invalid combinations representable, such as both `apiKey` and `chatgptAuth` being present, and they force call sites to infer meaning. A tagged union makes the selected credential path explicit and makes PAT/Bedrock compile-time visible.
  Date/Author: 2026-06-19 / Codex

- Decision: Do not implement JSON envelope fallback or token-prefix detection for PAT/Bedrock.
  Rationale: The repository rules reject heuristic inference here, and the database already has a first-class secret `kind`. Enveloping secrets would duplicate metadata inside encrypted payloads and make migration harder.
  Date/Author: 2026-06-19 / Codex

- Decision: Keep `CRADLE_CODEX_API_KEY`, `CODEX_API_KEY`, and `OPENAI_API_KEY` reserved for ordinary API-key auth only.
  Rationale: PAT and Bedrock have different semantics and should not be projected through generic API-key environment variables. Reusing API-key env vars would make auth status, rate-limit behavior, and diagnostics misleading.
  Date/Author: 2026-06-19 / Codex

- Decision: Bedrock must include explicit non-secret configuration instead of being inferred.
  Rationale: Bedrock has provider semantics such as region and possibly model-provider selection. Cradle should persist those values in Codex provider config and project them deliberately. Inferring Bedrock from `baseUrl`, model name, or secret kind alone would be ambiguous.
  Date/Author: 2026-06-19 / Codex

- Decision: Confirm Codex runtime credential ingestion keys from the synced runtime before coding app-server projection.
  Rationale: The generated TypeScript protocol has flexible JSON config and exposes auth status, but it does not type a PAT/Bedrock login request. Cradle must use the current Codex runtime's actual config/env contract rather than inventing a field that only tests would understand.
  Date/Author: 2026-06-19 / Codex

- Decision: Use Codex native env keys for PAT and Bedrock and the built-in `amazon-bedrock` model provider for Bedrock.
  Rationale: Codex `0.141.0` already owns these names. Cradle should project selected auth into that native boundary instead of creating Cradle-only keys that Codex would not read.
  Date/Author: 2026-06-19 / Codex

- Decision: Keep `readSecretValueWithMetadata` optional on the shared runtime-provider dependency type while requiring it in Codex credential-ref resolution.
  Rationale: Claude and other providers do not need secret metadata, and forcing every test fixture to implement it would widen this change unnecessarily. Codex still throws a wiring error if a credential ref is resolved without the metadata reader.
  Date/Author: 2026-06-19 / Codex

## Outcomes & Retrospective

Implementation is complete for the server adapter, provider-target normalization, secret metadata reading, Codex provider setup/edit UI, and Codex provider documentation. API-key auth remains the only path that sets `CRADLE_CODEX_API_KEY`, `CODEX_API_KEY`, and `OPENAI_API_KEY`. ChatGPT Login still uses `account/login/start` with `chatgptAuthTokens`. Personal Access Token now uses the `codex-personal-access-token` secret kind and projects `CODEX_ACCESS_TOKEN`. Bedrock now uses the `codex-bedrock-api-key` secret kind, stores `bedrock.region` in provider config, projects `AWS_BEARER_TOKEN_BEDROCK` and `AWS_REGION`, and writes Codex `amazon-bedrock` config. The broad web typecheck remains blocked by an unrelated diff-review file, but touched web files pass ESLint and all focused server validation passes.

## Context and Orientation

Cradle stores provider targets on the server. A provider target has `providerKind`, `configJson`, and `credentialRef`. The `configJson` field stores non-secret provider configuration such as model ID, base URL, Codex sandbox mode, and Codex auth mode. The `credentialRef` points to an encrypted secret row managed by `apps/server/src/modules/secrets/service.ts`. A secret row has a `kind`, a `label`, and encrypted secret text. Secret text must not be written to provider config JSON.

Codex is a Chat Runtime provider under `apps/server/src/modules/chat-runtime-providers/codex`. Chat Runtime is Cradle's server abstraction for running chat sessions. Codex app-server is the native Codex JSON-RPC process that Cradle starts and talks to. Cradle owns the provider adapter, profile configuration, secret persistence, and web provider setup. Codex owns native auth mode names and the app-server config/env keys that activate those modes.

The shared provider config schema is in `apps/server/src/modules/provider-contracts/provider-base.ts`. It defines `CodexAuthModeSchema`, `CodexConfigSchema`, `readTrustedCodexConfig`, and helper functions used by provider targets. Before this work, Codex auth modes were `apikey`, `chatgpt`, `chatgptAuthTokens`, and `agentIdentity`; the working tree now also includes `personalAccessToken` and `bedrockApiKey`.

The Codex auth resolver is in `apps/server/src/modules/chat-runtime-providers/codex/app-server/chatgpt-auth.ts`. Before this work, the resolver read `credentialRef`, tried to parse ChatGPT OAuth material, and otherwise treated the decrypted value as an API key. The working tree now resolves a tagged auth union from secret metadata and rejects selected PAT/Bedrock modes with the wrong credential kind.

The current Codex app-server config projection is in `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts`. It has `resolveCodexAuthMode`, `codexConfigRequiresApiKey`, `buildCodexExternalModelProviderConfig`, and `buildCodexConfig`. These functions decide which auth mode Codex receives and how Cradle places secrets in the child process environment.

The Codex app-server process wrapper is in `apps/server/src/modules/chat-runtime-providers/codex/app-server/client.ts`. It currently accepts `CodexAppServerClientOptions.apiKey` and, when present, writes that value into `CRADLE_CODEX_API_KEY`, `CODEX_API_KEY`, and `OPENAI_API_KEY`. Those variables must remain API-key-only.

The provider-target normalization path is in `apps/server/src/modules/provider-targets/service.ts`. It reads credential metadata and config to decide a stored `authMode`. Before this work, it treated only `chatgpt-auth` as ChatGPT auth and everything else as API-key auth; the working tree now maps `codex-personal-access-token` and `codex-bedrock-api-key` to their native Codex auth modes.

The shared provider context is in `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`, and the default runtime registry context is created in `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts`. This is where the Codex provider receives secret readers and other runtime services.

The web provider setup and edit flows live in `apps/web/src/features/agent-management/draft-setup-panel.tsx` and `apps/web/src/features/agent-management/profile-detail-panel.tsx`. Before this work, they saved typed API-key text as a secret with `kind: providerKind` and saved ChatGPT Login through a separate credential flow. The working tree now has a Codex auth mode control backed by `codex-auth-modes.ts` and `codex-auth-mode-controls.tsx`.

The generated Codex protocol files live under `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol`. They are generated and must not be edited by hand. `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/README.md` says to update the Codex runtime through the desktop package sync script and regenerate protocol bindings afterward.

For this plan, a Personal Access Token means a Codex-native account token selected by the user as `authMode: "personalAccessToken"`. A Bedrock API key means a Codex-native AWS Bedrock credential selected by the user as `authMode: "bedrockApiKey"`. A secret kind is a Cradle-owned string stored in the encrypted credentials table to identify what kind of credential the row contains. A tagged union is a TypeScript union where each variant has a `kind` field, making it impossible to confuse one credential path with another at compile time.

## Plan of Work

Do the work as one feature branch and one complete behavior change. The edits can be made in a sensible order, but the migration is not complete until both new modes pass acceptance. Do not leave Bedrock hidden behind product UI or tests once this plan is implemented.

First, confirm the current Codex runtime contract. From the repository root, inspect `apps/desktop/package.json` and use the current Codex runtime sync script. At the time this plan was written, the script is `pnpm --filter @cradle/desktop sync:codex-runtime`; `sync:codex-runtime:all` also exists for all bundled runtimes. After sync, run the server protocol generation command if generated files are stale. The server package has `generate:codex-app-server-protocol`, and the protocol README says this should regenerate `app-server-protocol` and then refresh capabilities. Inspect the generated protocol and the synced Codex runtime source for the exact way PAT and Bedrock credentials are accepted. If the synced runtime has no concrete config/env key or login method for a mode, stop and record the missing upstream contract in `Surprises & Discoveries` before coding Cradle projection.

Next, extend the server config model in `apps/server/src/modules/provider-contracts/provider-base.ts`. Add `personalAccessToken` and `bedrockApiKey` to `CodexAuthModeSchema`. Extend `CodexConfigSchema` with a `bedrock` object that contains non-secret Bedrock settings needed by Codex runtime. The minimum shape is `region: string` plus an optional provider/model-provider identifier only if the synced Codex runtime actually needs it. Keep Bedrock API keys out of `configJson`. Update `readTrustedCodexConfig` so new auth modes and Bedrock config survive parsing.

Then, add a secret metadata reader in `apps/server/src/modules/secrets/service.ts`. Keep `readSecret(id): string` for existing callers, but add a richer helper that returns the decrypted value together with the row metadata. The Codex resolver must use this helper so it can switch on the row's `kind`. Do not parse secret text to determine whether it is PAT or Bedrock.

Update the provider context boundary in `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` and the registry in `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts` so Codex can read secret metadata. If the interface change touches many tests, prefer a small shared test helper over optional fallback logic in production. The production Codex provider should treat a missing metadata reader as a wiring error, not as permission to guess.

Replace the current nullable auth resolution in `apps/server/src/modules/chat-runtime-providers/codex/app-server/chatgpt-auth.ts` with a tagged union. The resolver should switch on secret `kind` first. `chatgpt-auth` returns `chatgptAuthTokens` after parsing the existing ChatGPT payload. `codex-personal-access-token` returns `personalAccessToken`. `codex-bedrock-api-key` returns `bedrockApiKey`. Ordinary provider-kind secrets and inline/environment API keys return `apiKey`. If a config explicitly selects PAT or Bedrock but the referenced credential has the wrong kind, throw a provider configuration error rather than silently coercing it.

Update `apps/server/src/modules/provider-targets/service.ts` so credential kinds map to auth modes correctly. `chatgpt-auth` maps to `chatgptAuthTokens`, `codex-personal-access-token` maps to `personalAccessToken`, and `codex-bedrock-api-key` maps to `bedrockApiKey`. Ordinary secrets continue to map to `apikey`.

Update Codex runtime config projection in `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts`. `resolveCodexAuthMode` should switch on the tagged auth result, not nullable fields. `codexConfigRequiresApiKey` should require an API key only when an external OpenAI-compatible base URL is selected and the resolved mode is `apikey`. PAT and Bedrock must not require `CRADLE_CODEX_API_KEY`. `buildCodexConfig` should project Bedrock's non-secret config using the exact keys confirmed from the synced Codex runtime. If the synced runtime expects a named `model_provider`, use a clear Cradle-owned provider name such as `cradle-bedrock` only when Codex's config format requires a local provider entry; otherwise use the native Codex keys.

Update app-server process option construction in `apps/server/src/modules/chat-runtime-providers/codex/provider.ts` and `apps/server/src/modules/chat-runtime-providers/codex/app-server/bridge.ts`. Replace every `auth.apiKey` and `auth.chatgptAuth` read with tagged-union helpers. API-key auth may continue passing `apiKey` to `CodexAppServerClientOptions` if that remains the cleanest API-key path. PAT and Bedrock must pass only their confirmed native credential projection. If that projection is environment-based, add dedicated names that cannot be confused with OpenAI API-key variables. If the synced runtime already names the variables, use those names exactly. Cradle-owned wrapper names, if needed, should be separate from `CRADLE_CODEX_API_KEY`.

Update ChatGPT auth handling without changing its semantics. `buildCodexChatgptAuthLoginParams` remains the only path that calls `account/login/start` with `chatgptAuthTokens`. Because generated `LoginAccountParams` has no PAT or Bedrock variants, do not add fake login-start requests for those modes unless regeneration proves the protocol changed.

Update the web provider setup and profile edit flows. The Codex provider UI needs an auth mode selector with API Key, ChatGPT Login, Personal Access Token, and AWS Bedrock API Key. Use existing design-system controls already used in this feature area. API Key stores the current provider-kind secret and `authMode: "apikey"`. ChatGPT Login stores the existing `chatgpt-auth` secret and `authMode: "chatgptAuthTokens"`. Personal Access Token stores `kind: "codex-personal-access-token"`, saves the token through the existing secrets endpoint, and sets `authMode: "personalAccessToken"`. AWS Bedrock API Key stores `kind: "codex-bedrock-api-key"`, saves explicit non-secret Bedrock settings in Codex config, and sets `authMode: "bedrockApiKey"`. The UI must not write credential values into `configJson`.

Update API client types only if server OpenAPI shapes change. Secret save already accepts a string `kind`, so adding new secret kinds may not require OpenAPI changes. If server route schemas for Codex config or provider targets are changed, regenerate the web API client using the repository's existing generation command and stage only relevant generated files.

Update documentation near `apps/server/src/modules/chat-runtime-providers/codex/README.md` after implementation. The README should state that Codex supports four auth paths, name the two new secret kinds, and explain that PAT and Bedrock do not use generic API-key env vars.

Finally, add tests before declaring the plan complete. Server tests must cover resolver behavior, provider-target normalization, runtime config projection, app-server process options, and ChatGPT regression. Web tests should focus on pure config/save helpers if helper extraction exists or is introduced. Do not add broad React component tests just to click through form controls unless the feature already has local component-test patterns.

## Concrete Steps

Work from the repository root:

    cd /Users/wibus/dev/Cradle

Inspect the current scripts and generated protocol:

    sed -n '1,80p' apps/desktop/package.json
    sed -n '1,80p' apps/server/package.json
    sed -n '1,120p' apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/README.md
    sed -n '1,80p' apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/AuthMode.ts
    sed -n '1,120p' apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/v2/LoginAccountParams.ts
    sed -n '1,80p' apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/v2/Account.ts

Expected observations before implementation are that `AuthMode` includes `personalAccessToken` and `bedrockApiKey`, `LoginAccountParams` has no PAT or Bedrock login variant, and `Account` includes `amazonBedrock`.

Sync and regenerate Codex runtime/protocol only when needed:

    pnpm --filter @cradle/desktop sync:codex-runtime
    pnpm --filter @cradle/server generate:codex-app-server-protocol

If the desktop package script names change, use the script currently defined in `apps/desktop/package.json` rather than inventing another command. If regeneration changes generated protocol files, inspect the diff before implementation:

    git diff -- apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol apps/server/src/modules/chat-runtime-providers/codex/app-server/capabilities.ts

Inspect the current server auth model:

    sed -n '1,220p' apps/server/src/modules/provider-contracts/provider-base.ts
    sed -n '1,260p' apps/server/src/modules/chat-runtime-providers/codex/app-server/chatgpt-auth.ts
    sed -n '1,220p' apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts
    sed -n '1,130p' apps/server/src/modules/chat-runtime-providers/codex/app-server/client.ts
    sed -n '120,165p' apps/server/src/modules/provider-targets/service.ts
    sed -n '540,570p' apps/server/src/modules/chat-runtime/runtime-provider-types.ts

Search for nullable auth call sites and API-key env writes:

    rg -n "auth\\.apiKey|auth\\.chatgptAuth|CodexAppServerAuthResolution|resolveCodexAuthMode|codexConfigRequiresApiKey|CRADLE_CODEX_API_KEY|CODEX_API_KEY|OPENAI_API_KEY" apps/server/src/modules/chat-runtime-providers/codex -S

Inspect the secret store:

    sed -n '1,280p' apps/server/src/modules/secrets/service.ts
    sed -n '1,140p' apps/server/src/modules/secrets/model.ts

Inspect the web provider UI paths:

    sed -n '430,560p' apps/web/src/features/agent-management/profile-detail-panel.tsx
    sed -n '200,380p' apps/web/src/features/agent-management/draft-setup-panel.tsx
    sed -n '1,130p' apps/web/src/features/agent-management/provider-settings-utils.ts
    sed -n '1,120p' apps/web/src/features/agent-management/use-credential-metadata.ts

After implementation, run focused server tests:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/provider.test.ts src/modules/chat-runtime-providers/codex/app-server/bridge.test.ts src/modules/chat-runtime-providers/codex/app-server/client.test.ts

Expected result after the change:

    Test Files  3 passed
    Tests       all selected tests passed

Run provider-target and secret tests if touched or newly added:

    pnpm --filter @cradle/server exec vitest run src/modules/provider-targets src/modules/secrets tests/preferences.test.ts tests/external-provider-sources.test.ts

If no matching test files exist under `src/modules/provider-targets` or `src/modules/secrets`, run the nearest existing server tests that cover provider target creation and secret CRUD, and record the actual command here.

Run server typecheck:

    pnpm --filter @cradle/server typecheck

Expected result:

    tsc --noEmit exits with code 0

If web code changes, run web typecheck:

    pnpm --filter @cradle/web exec tsc --noEmit

Expected result:

    tsc --noEmit exits with code 0

Observed on 2026-06-19T06:13Z: this command is blocked by an unrelated error in `apps/web/src/features/diff-review/review-detail/guide-view.tsx(506,43)`. The touched web files were checked with:

    pnpm --filter @cradle/web exec eslint src/features/agent-management/draft-setup-panel.tsx src/features/agent-management/profile-detail-panel.tsx src/features/agent-management/codex-auth-mode-controls.tsx src/features/agent-management/codex-auth-modes.ts src/features/agent-runtime/profile-config-schema.ts

and ESLint exited with code 0.

If API client generation changes, run the repository's existing API generation command and then run the web typecheck again. Record the exact command and generated files in `Artifacts and Notes`.

Before committing or handing off, inspect the diff:

    git status --short
    git diff -- apps/server/src/modules/provider-contracts/provider-base.ts apps/server/src/modules/secrets/service.ts apps/server/src/modules/chat-runtime/runtime-provider-types.ts apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts apps/server/src/modules/provider-targets/service.ts apps/server/src/modules/chat-runtime-providers/codex apps/web/src/features/agent-management docs/exec-plans/20260619-03-codex-auth-modes.md

Do not revert unrelated dirty worktree changes. Stage only files touched for this auth-mode migration.

## Validation and Acceptance

The first acceptance behavior preserves existing API-key auth. A Codex provider with `authMode: "apikey"` and an ordinary API-key secret starts Codex app-server with the API-key path only. A focused test should assert that `CodexAppServerClientOptions.apiKey` is populated, that API-key env vars are present only for this mode, and that `buildCodexExternalModelProviderConfig` includes `env_key: "CRADLE_CODEX_API_KEY"` only when the selected auth mode is `apikey`.

The second acceptance behavior preserves ChatGPT Login. A provider whose credential is `kind: "chatgpt-auth"` still logs into Codex app-server through `account/login/start` with `type: "chatgptAuthTokens"`, refreshes tokens through the existing refresh path when needed, and never sets generic API-key env vars.

The third acceptance behavior proves Personal Access Token is native. A Codex provider with `config.authMode: "personalAccessToken"` and a secret row with `kind: "codex-personal-access-token"` starts a Codex session using the confirmed PAT projection. Tests must assert that the token is not passed as `apiKey`, is not placed in `CRADLE_CODEX_API_KEY`, `CODEX_API_KEY`, or `OPENAI_API_KEY`, and that `resolveCodexAuthMode` returns `personalAccessToken`.

The fourth acceptance behavior proves Bedrock is native and complete. A Codex provider with `config.authMode: "bedrockApiKey"`, a secret row with `kind: "codex-bedrock-api-key"`, and explicit Bedrock config such as `region` starts a Codex session using the confirmed Bedrock projection. Tests must assert that Bedrock does not fall through to API-key handling, that non-secret Bedrock config is present in the generated Codex config, and that app-server auth/account projection is handled when Codex reports `authMethod: "bedrockApiKey"` or account `type: "amazonBedrock"`.

The fifth acceptance behavior proves persistence ownership. Saving a PAT provider from the UI creates a secret with `kind: "codex-personal-access-token"` and provider config with `authMode: "personalAccessToken"`. Saving a Bedrock provider from the UI creates a secret with `kind: "codex-bedrock-api-key"` and provider config with `authMode: "bedrockApiKey"` plus non-secret Bedrock fields. Neither flow writes plaintext credentials into `configJson`.

The sixth acceptance behavior proves bad combinations fail loudly. If `authMode: "personalAccessToken"` references a `codex-bedrock-api-key` secret, or if `authMode: "bedrockApiKey"` references a generic provider-kind API-key secret, the server returns a provider configuration error. It must not silently coerce the credential to API-key auth.

The seventh acceptance behavior proves provider-target normalization. Creating or reading provider targets with `codex-personal-access-token` and `codex-bedrock-api-key` credential kinds preserves `authMode: "personalAccessToken"` and `authMode: "bedrockApiKey"` respectively. Existing ChatGPT and API-key targets keep their current normalized auth modes.

Manual validation, when real credentials are available, should start the server and create two Codex provider targets through the UI: one PAT target and one Bedrock target. Start a chat with each target. For PAT, observe that Codex app-server does not report missing OpenAI API key and that auth status is PAT if surfaced. For Bedrock, observe that the Codex account projection is `amazonBedrock` or that auth status is `bedrockApiKey` if surfaced. If real credentials are not available, the fake app-server tests are the required proof for this repository change.

Observed validation on 2026-06-19T06:13Z:

    pnpm --filter @cradle/server typecheck
    # passed; tsc --noEmit exited 0

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/provider.test.ts src/modules/chat-runtime-providers/codex/app-server/bridge.test.ts src/modules/chat-runtime-providers/codex/app-server/client.test.ts src/modules/chat-runtime-providers/codex/app-server/host-fingerprint.test.ts src/modules/chat-runtime-providers/codex/app-server/chatgpt-auth.test.ts tests/preferences.test.ts
    # passed; Test Files 6 passed, Tests 118 passed

    pnpm --filter @cradle/web exec eslint src/features/agent-management/draft-setup-panel.tsx src/features/agent-management/profile-detail-panel.tsx src/features/agent-management/codex-auth-mode-controls.tsx src/features/agent-management/codex-auth-modes.ts src/features/agent-runtime/profile-config-schema.ts
    # passed; exited 0

    pnpm --filter @cradle/web exec tsc --noEmit
    # failed in unrelated diff-review guide-view.tsx as described in Surprises & Discoveries

## Idempotence and Recovery

The code changes are direct refactors of the Codex auth boundary and additive secret metadata reading. Running sync, generation, tests, and typechecks multiple times is safe. Generated protocol files should only change when the synced Codex runtime changes; inspect generated diffs before keeping them.

Creating PAT or Bedrock secrets in development is safe as long as they use the normal encrypted secret store and are not written into provider config JSON. If a development secret cannot decrypt because `CRADLE_CREDENTIAL_SECRET` changed, use tests with mocked secret readers or create a fresh development credential. Do not add fallback logic that treats unreadable secrets as another auth mode.

If the Codex runtime contract for PAT or Bedrock cannot be confirmed locally, stop implementation and update this plan. Do not invent `auth_mode`, `pat_token`, `bedrock_api_key`, env var names, model-provider keys, or any other app-server projection without evidence from synced Codex runtime source or generated protocol.

If the tagged auth refactor becomes too wide, do not leave mixed nullable and tagged shapes in the Codex call path. Either finish migrating all Codex call sites in the same branch or revert only the local auth-shape edits you made. Never revert unrelated user changes in the worktree.

If changing `ProviderContext` causes widespread test churn, centralize test context creation instead of adding production compatibility fallbacks. The production behavior should remain strict: Codex auth resolution requires access to secret metadata.

If API generation produces unrelated churn, inspect whether the generation command picked up unrelated server changes. Keep only files required by this feature unless the user explicitly asks for broader generated updates.

## Artifacts and Notes

Current Codex auth mode schema before implementation:

    export const CodexAuthModeSchema = z.enum(['apikey', 'chatgpt', 'chatgptAuthTokens', 'agentIdentity'])

Current resolver shape before implementation:

    export interface CodexAppServerAuthResolution {
      apiKey: string | null
      chatgptAuth: CodexChatgptAuthCredential | null
    }

Target resolver shape after implementation:

    export type CodexAppServerAuthResolution =
      | { kind: 'apiKey', apiKey: string }
      | { kind: 'chatgptAuthTokens', chatgptAuth: CodexChatgptAuthCredential }
      | { kind: 'personalAccessToken', personalAccessToken: string }
      | { kind: 'bedrockApiKey', bedrockApiKey: string, region: string }
      | { kind: 'none' }

Target secret kinds:

    chatgpt-auth
    codex-personal-access-token
    codex-bedrock-api-key

API-key-only environment variables:

    CRADLE_CODEX_API_KEY
    CODEX_API_KEY
    OPENAI_API_KEY

Current generated protocol observations:

    AuthMode includes "personalAccessToken" and "bedrockApiKey".
    LoginAccountParams does not include PAT or Bedrock login variants.
    Account includes { "type": "amazonBedrock" }.

Runtime contract observations from Codex `rust-v0.141.0` source:

    Personal Access Token env: CODEX_ACCESS_TOKEN
    Bedrock bearer env: AWS_BEARER_TOKEN_BEDROCK
    Bedrock region env/config: AWS_REGION and model_providers.amazon-bedrock.aws.region
    Built-in Bedrock provider id: amazon-bedrock
    Native auth storage shape: auth_mode, personal_access_token, bedrock_api_key { api_key, region }

The current worktree may contain unrelated changes from other tasks. Before implementing this plan, check:

    git status --short

Do not revert unrelated work. Stage only files touched for this auth-mode feature.

## Interfaces and Dependencies

In `apps/server/src/modules/provider-contracts/provider-base.ts`, extend `CodexAuthModeSchema`:

    export const CodexAuthModeSchema = z.enum([
      'apikey',
      'chatgpt',
      'chatgptAuthTokens',
      'agentIdentity',
      'personalAccessToken',
      'bedrockApiKey',
    ])

In the same file, extend `CodexConfigSchema` with non-secret Bedrock config. Keep the shape minimal and evidence-based:

    bedrock: z.object({
      region: z.string().trim().min(1),
    }).optional()

If the synced Codex runtime proves different non-secret fields are required, use those fields and update this plan before implementation continues. Do not add broad `Record<string, unknown>` escape hatches for Bedrock config.

In `apps/server/src/modules/secrets/service.ts`, add:

    export interface SecretValueWithMetadata {
      id: string
      kind: string
      label: string
      secret: string
    }

    export function readSecretValueWithMetadata(id: string): SecretValueWithMetadata

The function should select the secret row, throw the existing `secret_not_found` error when absent, decrypt `encryptedSecret`, and return `id`, `kind`, `label`, and plaintext `secret`.

In `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`, expose secret metadata to runtime providers without forcing unrelated providers to implement it:

    readSecretValueWithMetadata?: (credentialRef: string) => SecretValueWithMetadata

In `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts`, wire it to `Secrets.readSecretValueWithMetadata`.

In `apps/server/src/modules/chat-runtime-providers/codex/app-server/chatgpt-auth.ts`, export secret-kind constants:

    export const CODEX_CHATGPT_AUTH_SECRET_KIND = 'chatgpt-auth'
    export const CODEX_PERSONAL_ACCESS_TOKEN_SECRET_KIND = 'codex-personal-access-token'
    export const CODEX_BEDROCK_API_KEY_SECRET_KIND = 'codex-bedrock-api-key'

Replace `CodexAppServerAuthResolution` with the tagged union shown in `Artifacts and Notes`. The resolver dependency should be:

    export interface CodexAppServerAuthResolverDeps {
      readSecretValueWithMetadata?: (credentialRef: string) => SecretValueWithMetadata
      readSecret: (credentialRef: string) => string
    }

Keep `readSecret` only for existing inline/environment API-key fallback if still needed. The credential-ref path must use `readSecretValueWithMetadata` and throw a wiring error if it is missing.

In `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts`, update these signatures:

    resolveCodexAuthMode(config: CodexConfig, auth: CodexAppServerAuthResolution): CodexAuthMode
    codexConfigRequiresApiKey(config: CodexConfig, auth: CodexAppServerAuthResolution): boolean
    buildCodexExternalModelProviderConfig(baseUrl: string, authMode: CodexAuthMode): Record<string, unknown>
    buildCodexConfig(..., auth: CodexAppServerAuthResolution): NonNullable<ThreadForkParams['config']>

Add a helper that returns process env for the selected auth only after confirming the synced runtime contract:

    export function buildCodexAuthEnvironment(auth: CodexAppServerAuthResolution): Record<string, string>

The helper must return API-key env vars only for `{ kind: 'apiKey' }`. PAT and Bedrock branches must use confirmed native keys or return no env if Codex expects config-only projection.

In `apps/server/src/modules/chat-runtime-providers/codex/app-server/client.ts`, keep `apiKey?: string` API-key-only or replace it with a more explicit auth env input. If it remains, tests must prove only `{ kind: 'apiKey' }` populates it.

In `apps/server/src/modules/provider-targets/service.ts`, update credential-kind to auth-mode mapping:

    chatgpt-auth -> chatgptAuthTokens
    codex-personal-access-token -> personalAccessToken
    codex-bedrock-api-key -> bedrockApiKey
    all ordinary provider API-key secrets -> apikey

In `apps/web/src/features/agent-management/profile-detail-panel.tsx` and `apps/web/src/features/agent-management/draft-setup-panel.tsx`, add a Codex auth mode selector and save logic for the four auth choices. The shared mode constants, secret-kind mapping, labels, and placeholders live in `apps/web/src/features/agent-management/codex-auth-modes.ts`; the feature-owned segmented control lives in `apps/web/src/features/agent-management/codex-auth-mode-controls.tsx`.

The UI must save PAT secrets with `kind: "codex-personal-access-token"` and `config.authMode = "personalAccessToken"`. It must save Bedrock secrets with `kind: "codex-bedrock-api-key"`, `config.authMode = "bedrockApiKey"`, and non-secret Bedrock config fields. It must not write PAT or Bedrock secret values to `configJson`.

Revision note, 2026-06-19T04:40Z: Initial ExecPlan created from the Codex auth-mode design discussion. It recorded PAT as the first shippable feature and Bedrock as an explicit but hidden future mode.

Revision note, 2026-06-19T04:55Z: Rewrote the plan as a one-shot complete migration for both `personalAccessToken` and `bedrockApiKey`. Removed the PAT-first/Bedrock-hidden approach, added provider-target normalization, secret metadata requirements, UI acceptance for Bedrock, and a strict requirement to confirm Codex runtime credential projection before coding.

Revision note, 2026-06-19T06:13Z: Updated the living plan after implementation. Recorded the GitHub 403 runtime-sync blocker, native Codex env/config discoveries from source, final server/UI implementation state, validation results, and the unrelated web typecheck blocker.
