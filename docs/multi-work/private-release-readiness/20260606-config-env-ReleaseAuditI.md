# Private Release Readiness Audit: Config, Environment, Updates, Logging, Telemetry

Date: 2026-06-06
Scope: environment/config/secrets/update channel/logging/telemetry defaults for private testers.
Exclusions: signing, notarization, certificate issues.
Mode: read-only audit; no source fixes applied.

## Summary

Cradle is close for packaged private tester builds if the build pipeline sets `CRADLE_DESKTOP_UPDATE_URL` and avoids Langfuse credentials. The highest readiness risks are release-channel configuration gaps and unsafe manual-server defaults in `.env.example`.

Packaged Desktop has a stronger first-run path than the standalone server: it creates a per-user credential secret under Electron `userData`, binds the server to loopback, writes logs under app data, and disables updates when no feed is configured. The standalone/server `.env.example` path is weaker and can lead private testers or operators to run with a shared credential encryption secret and optional external LLM tracing enabled.

## Findings

### High: Private update channel is fully env-driven and has no checked-in release feed/manifest guard

Evidence:
- `apps/desktop/electron.vite.config.ts:12` reads `CRADLE_DESKTOP_UPDATE_URL` and embeds it as `__CRADLE_DESKTOP_UPDATE_URL__`.
- `apps/desktop/electron-builder.mjs:25` returns no `publish` config when the env var is missing; `electron-builder.mjs:95-98` still enables channel detection and update file generation when publish exists.
- `apps/desktop/src/main/update-manager.ts:85-88` reads either runtime `process.env.CRADLE_DESKTOP_UPDATE_URL` or the embedded define.
- `apps/desktop/src/main/update-manager.ts:274-288` disables the updater when no feed URL exists, otherwise configures a generic feed.
- `apps/desktop/src/main/update-manager.ts:340-343` exposes the unsupported reason as `CRADLE_DESKTOP_UPDATE_URL is not configured`.
- `apps/desktop/scripts/README.md:24` documents that the same env var must be set before `dist:publish`.

Impact:
- A private tester build produced without `CRADLE_DESKTOP_UPDATE_URL` will ship with Desktop Updates permanently unavailable in Settings, blocking update-channel validation for private release.
- Because the release feed is only supplied through environment at build/publish time, readiness depends on external CI/operator state that is not verifiable from the repo alone.
- This does not block first launch, but it blocks private release update testing and regression recovery through the app's own update surface.

Confidence: High.

### High: `.env.example` encourages a shared credential encryption secret for standalone/server runs

Evidence:
- `.env.example:3` sets `CRADLE_CREDENTIAL_SECRET=change-me-server-secret`.
- `apps/server/src/modules/secrets/service.ts:35-48` derives the AES-256-GCM key from `CRADLE_CREDENTIAL_SECRET`.
- `apps/server/src/modules/secrets/service.ts:99-121` encrypts stored secrets with that key.
- `apps/server/src/config/server-config.ts:14-35` requires either `CRADLE_DATA_DIR` or `CRADLE_DB_PATH`, but it does not validate secret strength.
- Packaged Desktop avoids this specific default by generating a random secret when no env override exists in `apps/desktop/src/main/server-process.ts:243-257`.

Impact:
- Any private tester or operator who copies `.env.example` unchanged for a standalone server has provider credentials encrypted with a public, shared secret.
- This is most dangerous for non-packaged private test workflows and local debugging instructions. It is less severe for packaged Desktop first-run because Desktop generates a random per-user secret by default.

Confidence: High.

### Medium: Langfuse tracing can upload full AI SDK prompt/response data when credentials are present, with no Cradle-owned privacy preference or release-mode guard

Evidence:
- `.env.example:7-10` describes Langfuse as tracing "full prompt/response/token data" and points to `cloud.langfuse.com`.
- `apps/server/src/langfuse.ts:13-17` enables Langfuse whenever public and secret keys are set and `NODE_ENV !== 'test'`.
- `apps/server/src/index.ts:72-75` imports `./langfuse` during bootstrap before app creation.
- `apps/server/src/modules/chat-runtime-engine/ai-sdk-engine.ts:100-108` passes `experimental_telemetry: { isEnabled: true }` into `streamText` when Langfuse is enabled.
- Preferences only include chat, Codex user agent, Desktop quit behavior, and Jarvis defaults in `apps/server/src/modules/preferences/model.ts:20-56`; there is no telemetry/privacy preference.

Impact:
- Private testers running with Langfuse env vars will send LLM trace data to the configured Langfuse endpoint by default.
- This is probably intended for development observability, but it is not a safe private-tester default unless the test cohort explicitly consents and the configured endpoint is private.
- Packaged Desktop is safe only if the release environment does not inject Langfuse variables into the server child process.

Confidence: High.

### Medium: Diagnostics export redaction is partial and may miss OAuth-style secrets or provider-specific credentials

Evidence:
- `apps/web/src/features/settings/support-settings.tsx:171-192` exports a diagnostics JSON manually from Settings after flushing observability.
- `apps/server/src/modules/observability/exporter.ts:46-52` redacts only `sk-*`, `api_key`, `token`, and bearer authorization patterns.
- `apps/server/src/modules/observability/exporter.ts:97-101` applies that redaction to events, incidents, error patterns, timeline, and logs.
- `apps/server/src/modules/observability/exporter.ts:150-153` notes diagnostics stay local until the user shares them manually.
- `apps/server/src/modules/chat-runtime/run-snapshot.ts:118-120` retains run snapshot payloads up to 64k chars by default, with 30-day retention.

Impact:
- Export is manual and local, which is good for private testers, but the redaction rules are not broad enough to guarantee sanitized bundles.
- Tokens named `refreshToken`, `accessToken`, `client_secret`, provider-specific JSON fields, or non-`sk-*` credential formats could survive if they appear in error stacks, observability attrs, or run snapshot payloads.
- This is a support-process risk: testers may share sensitive diagnostics believing the built-in redaction is comprehensive.

Confidence: Medium.

### Medium: Observability and run-snapshot local retention defaults are always on and not surfaced as privacy controls

Evidence:
- `apps/server/src/modules/observability/service.ts:98-101` keeps an in-memory queue up to 5000 events and recent event window up to 2000.
- `apps/server/src/modules/observability/service.ts:462-488` persists observability event attrs as JSON.
- `apps/server/src/modules/chat-runtime/run-snapshot.ts:118-120` defaults payload limit to 64,000 chars and retention to 30 days.
- `apps/server/src/modules/chat-runtime/run-snapshot.ts:338-343` only disables snapshot pruning when `CRADLE_CHAT_RUN_SNAPSHOT_RETENTION_DAYS=0`; otherwise it retains non-running snapshots until cutoff.
- `apps/server/src/modules/preferences/model.ts:20-56` has no local diagnostics retention preference.

Impact:
- Private testers will accumulate local observability events, incidents, and backend run snapshots by default.
- This improves support and debugging, but private release notes/onboarding should explicitly state that diagnostics are local, what is retained, and how to clear or reduce retention.
- The risk is privacy expectation mismatch rather than external exfiltration.

Confidence: High.

### Low: Root `.env.example` is incomplete relative to documented and actual config surface

Evidence:
- `.env.example:2-10` includes only `CRADLE_DATA_DIR`, `CRADLE_CREDENTIAL_SECRET`, and Langfuse variables.
- `apps/server/README.md:47-54` documents additional server env vars: `CRADLE_DB_PATH`, `CRADLE_HOST`, `CRADLE_PORT`, `CRADLE_LOG_LEVEL`, `CRADLE_LOG_FILE`, `CRADLE_LOG_SYNC`.
- `apps/server/src/config/server-config.ts:14-35` actually reads host, port, log level, data dir, DB path, migrations dir, and log file.
- `apps/server/src/modules/chat-runtime/stream-trace.ts:60-80` supports opt-in stream trace env vars that are absent from the example.
- `apps/server/src/modules/chat-runtime/run-snapshot.ts:318-340` supports snapshot payload and retention env vars that are absent from the example.
- `apps/desktop/scripts/README.md:24` documents `CRADLE_DESKTOP_UPDATE_URL`, also absent from root `.env.example`.

Impact:
- Private release operators cannot infer the complete release/test configuration surface from `.env.example`.
- This increases the chance of accidental defaults, especially around update-channel setup, log retention, trace collection, and standalone server host/port.

Confidence: High.

## Positive Readiness Signals

- Packaged Desktop server binds to loopback and picks ports from `21423-21426` in `apps/desktop/src/main/server-process.ts:67-71`.
- Packaged Desktop injects `CRADLE_DATA_DIR`, `CRADLE_VERSION`, plugin paths, migrations dir, and `NODE_ENV=production` into the server child in `apps/desktop/src/main/server-process.ts:151-165`.
- Packaged Desktop generates a per-user credential secret when no env override exists in `apps/desktop/src/main/server-process.ts:243-257`.
- Updates are manual-download/manual-apply by default: `autoUpdater.autoDownload = false` and `autoInstallOnAppQuit = false` in `apps/desktop/src/main/update-manager.ts:282-283`.
- Request logging records method, path, status, and duration, not request bodies or headers, in `apps/server/src/http/request-logger.ts:24-34`.
- Diagnostics export is manual from Settings and local download only in `apps/web/src/features/settings/support-settings.tsx:171-192`.

## Recommended Release Gates

1. Verify CI/build environment sets `CRADLE_DESKTOP_UPDATE_URL` for private release artifacts and that Settings Desktop does not show `CRADLE_DESKTOP_UPDATE_URL is not configured`.
2. Ensure private tester launch environment does not include `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` unless the test cohort has explicit tracing consent and the endpoint is private.
3. Do not distribute standalone/server setup instructions that copy `.env.example` without replacing `CRADLE_CREDENTIAL_SECRET`.
4. Add private release notes explaining local diagnostics retention, manual export, and redaction limits before asking testers to share bundles.
5. Audit one generated diagnostics bundle with realistic provider credentials and OAuth tokens before using it in tester support workflows.

