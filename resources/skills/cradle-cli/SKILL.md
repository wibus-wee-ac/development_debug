---
name: cradle-cli
description: Interact with Cradle Kanban boards, issues, and workspaces via CLI. Use when you need to list/create/update/move issues, add comments, check statuses, delegate tasks, or query workspace data.
---

# Cradle CLI

Use `cradle` to manage Kanban issues, workspaces, and agents. Run `cradle --help` for the full command tree.

## Workspace

Your workspace is auto-detected from `cwd`. If you're working inside a project directory, commands that need a workspace just work. Use `--workspace <id>` to override.

## Working with Issues

```bash
# List issues in current workspace
cradle issue list

# Create an issue
cradle issue create -t "Fix login redirect"

# Update an issue
cradle issue update <id> -t "New title" -d "Updated description"

# Move to a status (use status ID from `cradle status list`)
cradle issue move <id> <statusId>

# Delegate to an agent (use agent ID from `cradle agent list`)
cradle issue delegate <issueId> <agentProfileId>
```

## Comments

```bash
cradle issue comment add <issueId> "Analysis complete."
cradle issue comment list <issueId>
```

Comments default to `authorKind: 'agent'`. Override with `--author-kind human`.

## Gotchas

- `cradle issue move` and `cradle issue delegate` take **IDs**, not names. Use `cradle status list` / `cradle agent list` to look up IDs first.
- `cradle issue create` requires `-t` (title). Other fields are optional.
- All output is JSON. Use `jq` for field extraction.
