---
name: cradle-cli
description: Interact with Cradle via the generated CLI. Use when you need to control Cradle from the terminal, or want to script interactions without using the HTTP API directly.
---

# Cradle CLI

Use `cradle` to manage Cradle or query its state from the terminal. You can use it for quick queries, scripted interactions, or as a reference for how the HTTP API maps to user-friendly commands.

## Core Rules

- `cradle man` prints the full generated command manual. Use `cradle man <module>` or `cradle man <command...>` to narrow it.
- This skill is not the full route list. It gives operating patterns and an auto-generated module index; exact commands come from `cradle man`.
- Default output is human-readable. Use `--json <fields>` for Agent workflows and `--format json` for compact pipeline output.
- Most relationships use IDs, but issue statuses are Agent-facing names/slugs. Use status names like `triage`, `to_do`, or `in_progress` instead of status IDs when creating or moving issues.
- Use `--server <url>` only when the default `CRADLE_SERVER_URL` / `http://localhost:21423` is not the intended server.

## Environment Variables

Cradle automatically injects these environment variables into your shell — no manual setup needed:

| Variable | Description |
| --- | --- |
| `CRADLE_CHAT_SESSION_ID` | Your current chat session ID |
| `CRADLE_WORKSPACE_ID` | The workspace ID for this session |

Use them directly in commands (e.g. `$CRADLE_CHAT_SESSION_ID`). They are available in both GUI (Claude Agent) and TUI (terminal) modes.

## Discovery

```bash
cradle --help
cradle man
cradle man issue
cradle man issue create
cradle man workspace git status
cradle workspace list --json id,name,path
cradle issue status list --workspace-id <workspaceId> --json id,name
cradle profile list --json id,name,providerKind,enabled
cradle agent list --json id,name,agentProfileId,enabled
```

## Issue Workflow

```bash
cradle issue list --workspace-id "$CRADLE_WORKSPACE_ID" --json id,title,statusId,priority,assigneeKind,assigneeId
cradle issue create --workspace-id "$CRADLE_WORKSPACE_ID" --title "Fix login redirect" --description "Describe the failure mode"
cradle issue create --workspace-id "$CRADLE_WORKSPACE_ID" --title "Triage build failure" --status-name triage
cradle issue move <issueId> in_progress
cradle issue update <issueId> --priority high --labels bug,agent
cradle issue get <issueId> --json id,title,description,statusId,priority
```

Omit `--status-name` to let the server attach the default workspace status. Use `cradle issue status list` only when you need to inspect available status names; status names are matched as lower-case slugs with spaces converted to underscores.

## Comments And Delegation

```bash
cradle issue comment list <issueId> --json id,content,createdAt
cradle issue comment add <issueId> --content "Analysis complete."
cradle issue delegate <issueId> --agent-profile-id <agentProfileId>
cradle issue delegation <issueId> --json issueId,delegated,agentProfileId,agentSessionId,chatSessionId
cradle issue undelegate <issueId>
```

## Workspace Helpers

```bash
cradle workspace list --json id,name,path
cradle workspace resolve --path "$PWD" --json id,name,path
cradle workspace files <workspaceId> --json type,name,path
cradle workspace file read <workspaceId> --path AGENTS.md
cradle workspace git status <workspaceId> --json branch,tracking,ahead,behind,isDetached
```

## Output Patterns

```bash
cradle issue list --workspace-id <workspaceId>
cradle issue list --workspace-id <workspaceId> --json id,title,statusId
cradle issue list --workspace-id <workspaceId> --format json
cradle issue list --workspace-id <workspaceId> --format ndjson
```

Use default output for human inspection, `--json <fields>` for structured Agent reads, and `--format ndjson` when streaming rows into shell pipelines.

## Chat Stream Trace

In development, chat runtime writes provider-to-SSE trace files under `CRADLE_DATA_DIR/chat-runtime/traces`. Use these commands to decide whether a streaming issue came from the provider, SDK mapper, projection, SSE emit, store, or UI layer.

```bash
cradle chat trace session "$CRADLE_CHAT_SESSION_ID" --format json
cradle chat trace session "$CRADLE_CHAT_SESSION_ID" --json traces
cradle chat trace run <runId> --format json
cradle chat trace run <runId> --json records
```

Inspect phases in order: `provider_raw`, `mapper_output`, `runtime_chunk`, `projection_apply`, `sse_emit`.

## Session Await (Pause & Resume)

Register an await to pause your session and let Cradle automatically resume it when an external condition is met:

```bash
# Register a CI wait on a PR — Cradle will resume this session when CI passes
cradle session await github-ci owner/repo \
  --pr 42 \
  --reason "Waiting for CI on PR #42"

# Register a CI wait on a specific commit (no PR needed)
cradle session await github-ci owner/repo \
  --sha abc123def \
  --reason "Waiting for CI on commit abc123def"

# Register a CI wait on one GitHub check run
cradle session await github-ci owner/repo \
  --run-id 1234567890 \
  --reason "Waiting for GitHub check run 1234567890"

# Register a PR review wait
cradle session await github-review owner/repo \
  --pr 42 \
  --mode approved \
  --reason "Waiting for PR #42 approval"

# Register a manual trigger-only wait
cradle session await manual \
  --reason "Waiting for deploy approval"

# Check await status
cradle session await-summary --session-id "$CRADLE_CHAT_SESSION_ID"

# List all awaits for current session
cradle session await-list --session-id "$CRADLE_CHAT_SESSION_ID"

# Cancel an await
cradle session await-cancel <awaitId>

# Manually trigger (for testing)
cradle session await-trigger <awaitId> --resume-text "CI passed"

# Retry delivery after a matched await failed to enqueue its resume message
cradle session await retry <awaitId>
```

**Key rules for await usage**:
- `$CRADLE_CHAT_SESSION_ID` and `$CRADLE_WORKSPACE_ID` are automatically injected as environment variables by Cradle — they are always available in your shell without any setup.
- After registering an await, end your turn. Cradle will resume the session with the trigger payload as a new user message.
- Prefer the task-shaped `cradle session await ...` commands. The raw generated `cradle session await-create` command is still available when you need to pass a custom source/filter payload directly.
- Supported sources: `github-ci` (`--pr`, `--sha`, or `--run-id`), `github-review` (`--mode approved|changes-requested|reviewed`), and `manual`.
- Your session history is preserved — when resumed, you have full context of what you were doing.

<!-- CRADLE_CLI_MODULES_START -->
## Command Modules

It intentionally lists modules, not routes or leaf actions. Use `cradle man <module>` for full command manuals.

| Module | Commands | Scope | Manual |
| --- | ---: | --- | --- |
| `acp` | 9 | Manage ACP agent installation and registry state. | `cradle man acp` |
| `agent` | 5 | Manage Cradle agent identities. | `cradle man agent` |
| `automation` | 13 | Manage scheduled automations, runs, and artifacts. | `cradle man automation` |
| `board` | 4 | Manage Kanban boards. | `cradle man board` |
| `chat` | 8 | Control chat runtime commands. | `cradle man chat` |
| `chronicle` | 49 | Generated Cradle CLI module. | `cradle man chronicle` |
| `health` | 1 | Check server health. | `cradle man health` |
| `issue` | 28 | Manage Kanban issues, comments, relations, delegation, and context refs. | `cradle man issue` |
| `issue-agent-session` | 3 | Inspect and control issue agent sessions. | `cradle man issue-agent-session` |
| `observability` | 3 | Inspect local observability events, incidents, and exports. | `cradle man observability` |
| `preferences` | 4 | Read and update server preferences. | `cradle man preferences` |
| `profile` | 5 | Manage agent profiles. | `cradle man profile` |
| `provider` | 1 | Inspect provider model availability. | `cradle man provider` |
| `search` | 2 | Search Cradle data. | `cradle man search` |
| `secret` | 2 | Manage secret metadata. | `cradle man secret` |
| `session` | 17 | Manage chat sessions and session links. | `cradle man session` |
| `skill` | 10 | Manage skills and skill sources. | `cradle man skill` |
| `usage` | 7 | Inspect usage and cost data. | `cradle man usage` |
| `workflow-rule` | 4 | Manage workflow rules. | `cradle man workflow-rule` |
| `workspace` | 21 | Manage workspaces, files, git helpers, and codebase packing. | `cradle man workspace` |

<!-- CRADLE_CLI_MODULES_END -->

