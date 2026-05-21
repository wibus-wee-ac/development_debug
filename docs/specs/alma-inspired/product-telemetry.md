<!--
Input: Alma Sentry/PostHog evidence and Cradle observability audit.
Output: Spec for crash reporting and product telemetry.
Position: docs/specs/alma-inspired/product-telemetry.md
-->

# Product Telemetry

## Goal

Cradle should keep local observability distinct from optional release crash reporting and product analytics.

## Alma Evidence

Alma includes Sentry Electron release metadata and renderer PostHog provider signals. Settings include analytics-related UI signals.

## Cradle Current State

Cradle has local observability events/incidents, server logs, Langfuse tracing, and devtools. No Electron crash reporting or product analytics opt-in/out surface was found.

## Target Ownership

`apps/desktop` owns crash reporting. `apps/web` owns product analytics capture points. `preferences` owns consent. `observability` remains local diagnostics and should not be conflated with external telemetry.

## Target Behavior

- Telemetry is disabled or privacy-safe by default according to product policy.
- Users can see and change telemetry consent.
- Crash reports redact paths, prompts, secrets, and message content unless explicitly allowed.
- Local observability remains available without external telemetry.

## API / IPC Sketch

- `GET /preferences/telemetry`
- `PUT /preferences/telemetry`
- `desktop.telemetry.captureCrash(metadata)`

## Data Model

Persist consent, last changed time, and policy version. Do not persist raw analytics events in Cradle DB unless needed for local diagnostics.

## Acceptance

- Disabling telemetry stops external event emission immediately.
- Crash reporting redaction is tested with paths, prompts, and secrets.
- Local devtool observability still works when telemetry is off.
