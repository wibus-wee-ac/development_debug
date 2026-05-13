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
- Most relationships use IDs, not names. Query the relevant list command first, then pass the ID to create/update/delegate commands.
- Use `--server <url>` only when the default `CRADLE_SERVER_URL` / `http://localhost:21423` is not the intended server.

## Discovery

```bash
cradle --help
cradle man
cradle man issue
cradle man issue create
cradle man workspace git status
cradle workspace list --json id,name,path
cradle status list --workspace-id <workspaceId> --json id,name
cradle profile list --json id,name,providerKind,enabled
cradle agent list --json id,name,agentProfileId,enabled
```

## Issue Workflow

```bash
cradle issue list --workspace-id <workspaceId> --json id,title,statusId,priority,assigneeKind,assigneeId
cradle issue create --workspace-id <workspaceId> --title "Fix login redirect" --description "Describe the failure mode"
cradle issue update <issueId> --status-id <statusId>
cradle issue update <issueId> --priority high --labels bug,agent
cradle issue get <issueId> --json id,title,description,statusId,priority
```

Use `status list`, `milestone list`, and `profile list` to resolve IDs before mutating an issue.

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

<!-- CRADLE_CLI_MODULES_START -->
## Command Modules

It intentionally lists modules, not routes or leaf actions. Use `cradle man <module>` for full command manuals.

| Module | Commands | Scope | Manual |
| --- | ---: | --- | --- |
| `acp` | 9 | Manage ACP agent installation and registry state. | `cradle man acp` |
| `agent` | 5 | Manage Cradle agent identities. | `cradle man agent` |
| `approval` | 2 | Inspect and respond to pending approvals. | `cradle man approval` |
| `board` | 4 | Manage Kanban boards. | `cradle man board` |
| `chat` | 2 | Control chat runtime commands. | `cradle man chat` |
| `health` | 1 | Check server health. | `cradle man health` |
| `issue` | 18 | Manage Kanban issues, comments, relations, delegation, and context refs. | `cradle man issue` |
| `issue-agent-session` | 3 | Inspect and control issue agent sessions. | `cradle man issue-agent-session` |
| `milestone` | 4 | Manage Kanban milestones. | `cradle man milestone` |
| `observability` | 3 | Inspect local observability events, incidents, and exports. | `cradle man observability` |
| `preferences` | 2 | Read and update server preferences. | `cradle man preferences` |
| `profile` | 4 | Manage agent profiles. | `cradle man profile` |
| `provider` | 2 | Inspect provider health and model availability. | `cradle man provider` |
| `search` | 1 | Search Cradle data. | `cradle man search` |
| `secret` | 2 | Manage secret metadata. | `cradle man secret` |
| `session` | 10 | Manage chat sessions and session links. | `cradle man session` |
| `skill` | 10 | Manage skills and skill sources. | `cradle man skill` |
| `status` | 5 | Manage Kanban statuses. | `cradle man status` |
| `usage` | 7 | Inspect usage and cost data. | `cradle man usage` |
| `workflow-rule` | 4 | Manage workflow rules. | `cradle man workflow-rule` |
| `workspace` | 17 | Manage workspaces, files, git helpers, and codebase packing. | `cradle man workspace` |

<!-- CRADLE_CLI_MODULES_END -->

