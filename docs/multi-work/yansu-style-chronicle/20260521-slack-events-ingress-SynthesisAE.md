# Yansu-Style Chronicle Slack Events Ingress Synthesis

## Scope

本 slice 把 Slack 从后台轮询和手动同步推进到可被 Slack Events API 主动推送的 realtime ingress，同时保留 polling fallback。

它实现的是：

- Chronicle-owned Slack source realtime config。
- Slack Events API HTTP callback route。
- Raw body HMAC signature verification。
- Slack URL verification challenge。
- Channel allowlist、duplicate suppression、message/app mention ingest。
- Web Settings 中的 Slack realtime mode 配置和 callback URL 展示。

它不实现：

- Slack Socket Mode websocket worker lifecycle。
- Slack OAuth app installation。
- Slack permalink enrichment。
- Slack user profile name hydration beyond event/history payloads。

## Implemented Behavior

### Server

`chronicle_message_sources.config_json` now carries Slack realtime config:

```json
{
  "realtimeMode": "events-api",
  "signingSecretRef": "secret-id"
}
```

No new DB table or column was required. Bot token and signing secret plaintext remain owned by the `secrets` module. Chronicle stores only refs and source configuration.

New route:

```text
POST /chronicle/message-sources/:sourceId/slack/events
```

The route uses Elysia `parse: 'none'` and reads `request.text()` so Slack signature verification receives the exact raw body. `handleSlackEvents()` verifies:

- `x-slack-signature`
- `x-slack-request-timestamp`
- five-minute timestamp tolerance
- Slack `v0:{timestamp}:{rawBody}` HMAC-SHA256 signature

URL verification returns the challenge as `text/plain`. Event callbacks ingest `message` and `app_mention` payloads only after signature verification and channel allowlist checks. Duplicate events reuse the existing `recordSlackMessage()` dedup key:

```text
sourceId + channelId + messageTs
```

Polling remains available through:

```text
POST /chronicle/message-sources/:sourceId/sync
```

and Server background polling still calls `runSlackSyncTick()`.

### Web

Settings > Chronicle > Slack now lets the user choose:

- `Events API`
- `Polling`

When Events API is selected, Web collects the Slack signing secret and saves it through `/secrets` with kind:

```text
chronicle.slack.signing-secret
```

The source list displays the realtime mode and Events API callback URL:

```text
<server-url>/chronicle/message-sources/<sourceId>/slack/events
```

Bot token and signing secret values are never written to Chronicle config or Web state after save.

## Validation

Commands run:

```text
pnpm exec drizzle-kit generate --config drizzle.config.ts
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
```

Observed results:

- Drizzle returned `No schema changes, nothing to migrate`.
- Server typecheck passed.
- Chronicle server test passed.
- Chronicle Web eslint passed.

Test coverage added in `apps/server/tests/chronicle.test.ts`:

- signed Slack URL verification returns plaintext challenge
- invalid signature returns 401
- stale timestamp returns 401
- outside-channel event is ignored and does not insert
- valid signed event inserts one normalized message
- duplicate signed event inserts zero additional messages
- derived memory is searchable through Chronicle memory search
- Chronicle source row does not contain signing secret plaintext

## Follow-Up

Next Slack work should be Socket Mode lifecycle only if it materially improves local user setup. The reusable boundary is now clear: Socket Mode should dispatch Slack events into `handleSlackEvents()`-equivalent normalized event processing without bypassing source config, secret refs, allowlist, or dedup.
