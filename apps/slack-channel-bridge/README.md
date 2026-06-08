# Slack Channel Bridge

Independent Slack bridge for continuing Cradle sessions from Slack threads.

This app is intentionally separate from Cradle Server. It handles Slack protocol details, stores external Slack mappings in its own SQLite database, and talks to Cradle only through a generated OpenAPI client.

## Runtime Model

- A Slack channel can be bound to one default Cradle workspace.
- A Slack thread is bound to one Cradle session.
- The bridge stores `team_id + channel_id + thread_ts -> cradle_session_id` in its own SQLite database.
- Cradle remains the owner of sessions, messages, chat runtime, files, approvals, and workspace semantics.
- Slack messages are ingress events and delivery evidence, not canonical chat state.

## Setup

Create a Slack app at <https://api.slack.com/apps>.

Enable Socket Mode and create an app-level token with:

- `connections:write`

Add bot token scopes:

- `chat:write`
- `commands`
- `app_mentions:read`
- `channels:history`
- `groups:history`

Create a slash command:

- Command: `/cradle`
- Request URL: any placeholder URL when using Socket Mode
- Usage hint: `[bind|unbind|status]`

Subscribe to bot events:

- `app_mention`
- `message.channels`
- `message.groups`

Invite the bot into the Slack channel:

    /invite @YourCradleBot

## Configuration

Create `apps/slack-channel-bridge/.env`:

    SLACK_BOT_TOKEN=xoxb-your-bot-token
    SLACK_APP_TOKEN=xapp-your-app-level-token
    SLACK_SIGNING_SECRET=your-signing-secret

    CRADLE_API_BASE_URL=http://127.0.0.1:21423

    # Required: choose one way for the bridge to create Cradle sessions.
    # Agent ID is preferred because it carries the intended runtime/provider config.
    CRADLE_SLACK_AGENT_ID=agent-your-default-agent

    # Or use a provider target directly:
    # CRADLE_SLACK_PROVIDER_TARGET_ID=provider-target-id
    # CRADLE_SLACK_RUNTIME_KIND=standard
    # CRADLE_SLACK_MODEL_ID=optional-model-id

    SLACK_CHANNEL_BRIDGE_DB_PATH=~/.cradle/slack-channel-bridge/bridge.sqlite
    SLACK_CHANNEL_BRIDGE_LOG_LEVEL=info

The default SQLite path is bridge-owned and separate from the Cradle server database.

Cradle requires every created session to have an agent or provider target. The bridge fails fast at startup unless `CRADLE_SLACK_AGENT_ID` or `CRADLE_SLACK_PROVIDER_TARGET_ID` is configured.

## Generate Client

The bridge uses `@hey-api/openapi-ts` against Cradle Server's OpenAPI snapshot:

    pnpm --filter @cradle/slack-channel-bridge generate

This writes generated files under:

    apps/slack-channel-bridge/src/generated/cradle-api

Do not edit generated files manually.

## Running

Start Cradle Server:

    pnpm dev:server

Start the bridge:

    pnpm --filter @cradle/slack-channel-bridge dev

In Slack, bind a channel to a Cradle workspace:

    /cradle bind workspace <workspace-id>

Mention the bot in the channel:

    @Cradle summarize the current workspace risks

The bridge creates a Cradle session, binds the Slack thread to that session, sends the Slack message to Cradle, and posts the assistant response back into the same thread.

Replying later in that same Slack thread reuses the same Cradle session.

## Commands

    /cradle bind workspace <workspace-id>

Bind the current Slack channel to a Cradle workspace.

    /cradle status

Show the current channel binding and recent Slack thread to Cradle session mappings.

    /cradle unbind

Remove the current channel binding. Existing thread bindings remain in SQLite so already-started conversations can still be inspected.

## Validation

Run:

    pnpm --filter @cradle/slack-channel-bridge verify

Or run each check separately:

    pnpm --filter @cradle/slack-channel-bridge typecheck
    pnpm --filter @cradle/slack-channel-bridge test
    pnpm --filter @cradle/slack-channel-bridge build

The tests use temporary SQLite files and fake Slack/Cradle services. They do not need Slack credentials or a running Cradle server.
