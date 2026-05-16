# Troubleshooting

This guide covers common operational issues for users and integration developers.

## 1. CLI Cannot Connect to Cradle

### Symptom

`Cannot connect to Cradle. Is the app running?`

### Cause

The local JSON-RPC socket is unavailable.

### Resolution

1. Start Cradle desktop app.
2. Retry CLI command.
3. Ensure command is run under the same local user account.
4. If still failing, restart Cradle and retry.

## 2. Session Does Not Stream New Messages

### Symptom

Session opens but no new chat deltas appear.

### Cause

The active run did not start, or the SSE stream is missing/stale.

### Resolution

1. Confirm active session tab is focused.
2. Reopen the session tab.
3. Verify `GET /chat/sessions/:sessionId/messages` returns the latest message snapshot rows.
4. Verify the active run stream emits `message_delta` / `subagent_message_delta` / `run_*` events.
5. Use Devtool or network inspection to confirm the SSE stream stays connected.

## 3. TUI Session Shows Empty Terminal

### Symptom

CLI-TUI tab opens but terminal has no output.

### Cause

PTY start failed, profile misconfigured, or non-`cli-tui` provider profile selected.

### Resolution

1. Check provider profile kind is `cli-tui`.
2. Validate executable/args in profile config.
3. Check if PTY is running via diagnostics.
4. Restart session.

## 4. Workspace Files Not Appearing in Mention/Search

### Symptom

Expected files are missing from mention panel or search results.

### Cause

Workspace path mismatch, file filtering, or stale index state.

### Resolution

1. Confirm workspace path is correct.
2. Reopen workspace tab.
3. Ensure files are under workspace root.
4. Re-run search with a broader query.

## 5. Issue Delegation Stuck in `created`

### Symptom

Delegated issue never advances to active/completed state.

### Cause

Delegation runtime launch failure or provider profile issues.

### Resolution

1. Validate delegated agent profile configuration.
2. Check Agent activities feed for error records.
3. Stop and re-run delegation.
4. Inspect Devtool for runtime events.

## 6. Usage Dashboard Is Empty

### Symptom

No usage data despite active sessions.

### Cause

No provider usage tokens recorded for completed turns yet.

### Resolution

1. Run at least one successful model response.
2. Wait for persistence flush.
3. Reopen Usage tab.
4. Check session usage through IPC for targeted validation.

## 7. Devtool Panel Appears Empty

### Symptom

IPC/ACP/observability panels show no events.

### Cause

No recent activity, filters too strict, or buffer was cleared.

### Resolution

1. Trigger fresh activity (session send, PTY input, settings calls).
2. Reset panel filters.
3. Refresh snapshot.
4. Use `flushObservability` before export when needed.

## 8. Session Markdown Export Looks Incomplete

### Symptom

Exported markdown misses expected assistant output details.

### Cause

Assistant export depends on persisted message snapshots and the derived `messages.content` plain-text cache.

### Resolution

1. Ensure session turn completed and persisted.
2. Retry export after session refresh.
3. Compare the exported text with the current chat message snapshot after refresh.

## 9. Settings Changes Not Reflected Immediately

### Symptom

Provider/agent/skills changes appear stale in another view.

### Cause

View-level query cache not invalidated yet.

### Resolution

1. Reopen affected tab.
2. Trigger refresh action in that settings pane.
3. If needed, restart app to force fresh hydration.

## 10. Safe Recovery Checklist

When behavior is unclear:

1. Verify workspace and provider profile mapping first.
2. Reproduce with minimal steps in a fresh session.
3. Inspect Devtool traces.
4. Export observability bundle for offline analysis.
5. Keep operations within Cradle-owned APIs and namespaces.
