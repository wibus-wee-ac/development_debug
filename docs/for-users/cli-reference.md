# CLI Reference

Cradle includes a local CLI client exposed as `cradle`.

## 1. Prerequisites

- Cradle desktop app must be running.
- CLI communicates through a local JSON-RPC socket.
- In this repository, the command is wired through:

```bash
cradle
```

or directly:

```bash
npx tsx src/cli/index.ts
```

## 2. Global

```bash
cradle --help
cradle --version
```

## 3. Workspace Commands

### List workspaces

```bash
cradle workspace list
```

### Resolve workspace by path

```bash
cradle workspace resolve [path]
```

- If `path` is omitted, current working directory is used.

### Get workspace by id

```bash
cradle workspace get <workspaceId>
```

## 4. Board Commands

### List boards

```bash
cradle board list --workspace <workspaceId>
```

If `--workspace` is omitted, CLI attempts to resolve from current directory.

## 5. Status Commands

### List statuses

```bash
cradle status list --workspace <workspaceId>
```

If `--workspace` is omitted, CLI attempts to resolve from current directory.

## 6. Issue Commands

### List issues

```bash
cradle issue list --workspace <workspaceId> [--milestone <milestoneId>] [--status <statusId>] [--assignee <assigneeId>]
```

### Get issue

```bash
cradle issue get <issueId>
```

### Create issue

```bash
cradle issue create --workspace <workspaceId> --title "..." [--description "..."] [--status <statusId>] [--priority <0-4>]
```

### Update issue

```bash
cradle issue update <issueId> [--title "..."] [--description "..."] [--priority <0-4>]
```

### Move issue to another status

```bash
cradle issue move <issueId> <statusId>
```

### Delegate issue to agent profile

```bash
cradle issue delegate <issueId> <agentProfileId>
```

### Cancel delegation

```bash
cradle issue undelegate <issueId>
```

### Delete issue

```bash
cradle issue delete <issueId>
```

## 7. Issue Comment Commands

### List comments

```bash
cradle issue comment list <issueId>
```

### Add comment

```bash
cradle issue comment add <issueId> "<content>" [--author-kind <user|agent|system>]
```

### Delete comment

```bash
cradle issue comment delete <commentId>
```

## 8. Agent Commands

### List agents

```bash
cradle agent list
```

### Get agent

```bash
cradle agent get <agentId>
```

## 9. Output and Error Behavior

- Most successful commands print JSON output.
- Destructive operations may print `Done`.
- If socket is unavailable, CLI returns:
  - `Cannot connect to Cradle. Is the app running?`

## 10. Automation Tips

- Pipe JSON outputs to `jq` for scripting.
- Resolve workspace once per script and reuse its id.
- Prefer explicit IDs over name matching to avoid ambiguity.
