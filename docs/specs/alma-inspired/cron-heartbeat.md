<!--
Input: Alma cron/heartbeat evidence and Cradle automation/session-await audit.
Output: Spec for cron jobs, heartbeat, and channel status.
Position: docs/specs/alma-inspired/cron-heartbeat.md
-->

# Cron And Heartbeat

## Goal

Cradle should separate generic scheduled automation from channel heartbeat/status delivery, while allowing channel owners to reuse automation runs.

## Alma Evidence

Alma exposes cron jobs, heartbeat config/status, Telegram/Discord/Feishu group status, scheduled message delivery, and TTS-adjacent voice/file behavior.

## Cradle Current State

Cradle automation supports RRULE schedules, run-now, runs, artifacts, and runtime kinds. Session Await supports GitHub checks/reviews. No channel heartbeat/status delivery module was found.

## Target Ownership

`automation` owns schedules and run lifecycle. A future `channels` module owns channel status and delivery. Feature-specific jobs register recipes instead of writing schedule tables directly.

## Target Behavior

- Users can schedule recurring jobs using existing automation semantics.
- Channel connectors can expose heartbeat targets and delivery health.
- Heartbeat results are auditable and visible in channel status.
- Missed or failed jobs surface structured retry information.

## API Sketch

- `GET /automations`
- `POST /automations`
- `GET /channels/heartbeat/status`
- `PUT /channels/heartbeat/config`
- `POST /channels/:id/heartbeat/test`

## Data Model

Automation keeps schedule and run records. Channels own heartbeat target config, last delivery status, and connector health snapshots.

## Acceptance

- A scheduled channel heartbeat records an automation run and a channel delivery attempt.
- Disabling a channel prevents new heartbeat deliveries but does not delete automation history.
- Failed heartbeat delivery includes connector-specific diagnostics.
