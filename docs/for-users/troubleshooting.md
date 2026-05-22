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

## 11. Export a Diagnostics Bundle

预览版的 diagnostics export 是手动、本地优先流程。

1. 打开 `Settings > Support`。
2. 点击 `Export`。Cradle 会先调用 observability flush，再下载 `cradle-diagnostics-*.json`。
3. 打开 JSON 文件并检查其中的 `events`、`incidents` 和 `timeline`。
4. 删除不想分享的本地路径、workspace 名称、provider 错误上下文或其他敏感内容。
5. 点击 `Copy` 复制反馈模板，或者点击 `Open` 打开 GitHub issue 页面。
6. 只在确认内容可分享后，手动附加 diagnostics JSON。

如果 `Export` 返回空 bundle，先复现一次问题，再重新点击 `Export`。如果按钮报错，重启 Cradle 后再次执行；仍失败时，把错误文案和复现步骤写进反馈模板。

## 12. Reveal Cradle Data Directory

在 Electron desktop 中，`Settings > Support > Reveal` 会打开 Cradle-owned data directory。这个目录通常包含 local database、server log、plugin/runtime state 和 observability buffer。Web preview 没有 native filesystem reveal 能力，所以该按钮会保持不可用。

Reveal 动作不会上传、删除或迁移数据。它只是帮助用户检查、备份或定位本地文件。删除这些文件可能会移除 workspaces metadata、sessions、provider profiles、Kanban records 和 diagnostics history；删除前应先退出 Cradle 并自行备份。

## 13. Uninstall and Retained Data

使用操作系统的正常 uninstall flow 可以移除 Cradle app binary。预览版默认保留 Cradle-owned user data，避免误卸载导致 work history 丢失。

如果用户想彻底清理 retained data，先从 `Settings > Support > Reveal` 打开 data directory，退出 Cradle，然后再按需删除该目录。不要删除 repository workspace 本身，除非用户明确想删除自己的项目文件；workspace path 是 non-Cradle-owned 数据边界。
