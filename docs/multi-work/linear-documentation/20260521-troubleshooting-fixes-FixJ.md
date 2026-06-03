# Troubleshooting Fixes

Agent: `FixJ`

Scope: only `documentations/content/docs/troubleshooting/desktop-server.mdx`, `documentations/content/docs/troubleshooting/chronicle.mdx`, and this handoff file.

## Summary

ReviewH 的剩余阻塞点是 troubleshooting fidelity。两页原本只按 generic symptom 排障，没有把用户实际看到的 dialog、log、health panel 文案，以及 Chronicle status fields 放进定位路径。

本次修复把两个页面改成 message/status-driven tables：

- `desktop-server.mdx` 现在按 crash dialog、desktop log 和 Server Health UI message 定位。
- `chronicle.mdx` 现在按 `GET /chronicle/status` fields、server event messages、summary failure strings 和 Rust daemon stderr 定位。

没有修改 routes、ExecPlan、app code 或 Chronicle code。

## Evidence Used

Desktop server evidence:

- `apps/desktop/src/main/server-process.ts`:
  - `[desktop] Server process exited unexpectedly (code=..., signal=...)`
  - `[desktop] Restarting server (attempt .../3)...`
  - `[desktop] Server restart failed:`
  - `Server Error`
  - `The Cradle server has stopped unexpectedly.`
  - `Exit code: ...`
  - `Server failed to start within ...ms`
  - `[desktop] Server started on ...`
- `apps/web/src/features/devtool/health/health-panel.tsx`:
  - `Failed to fetch server health:`
  - `HTTP ...`
  - `Status`
  - `Uptime`
  - memory rows rendered from `/health`

Chronicle evidence:

- `apps/server/src/modules/chronicle/service.ts`:
  - status fields: `available`, `running`, `pid`, `lastCaptureAt`, `lastSummaryAt`, `lastErrorAt`, `lastError`, `lastExitCode`, `lastExitAt`, `totalSnapshots`, `totalSummaries`, `totalMessages`, `lastMessageAt`, `configuredModel`
  - event messages: `Chronicle enabled`, `Chronicle disabled`, `Chronicle daemon start requested`, `Chronicle daemon failed to start`, `Chronicle daemon stop requested`, `Chronicle summary generated`
  - summary failures: `[Chronicle error - ...]`, `[Chronicle error - no API key available for profile]`, `[Chronicle error - Chronicle is not enabled]`
- `apps/server/src/modules/chronicle/daemon-manager.ts`:
  - daemon process state, `lastExitCode`, `lastExitAt`, stderr prefix `[chronicle-daemon]`
- `chronicle/src/daemon.rs`:
  - `cradle chronicle capture error: ...`
  - `cradle chronicle summary error: ...`
  - `cradle chronicle final summary error`
  - `another Chronicle instance is already running (lock held)`
  - `another Chronicle instance is already running (lock file exists)`
- `chronicle/src/screen/macos.rs`:
  - `macOS capture is only available on macOS`
  - `CGDisplayCreateImage returned null. Grant Screen Recording permission.`
- `chronicle/src/daemon.rs`:
  - `macOS capture provider is only available on macOS`

## Changes

`documentations/content/docs/troubleshooting/desktop-server.mdx`:

- Replaced the generic `Common causes` table with `Message table`.
- Added rows for:
  - `The Cradle server has stopped unexpectedly.`
  - `Exit code: ...`
  - `[desktop] Server process exited unexpectedly (code=..., signal=...)`
  - `[desktop] Server restart failed:`
  - `Server failed to start within ...ms`
  - `Failed to fetch server health: HTTP ...`
  - `Failed to fetch server health: TypeError...`
- Added `When to export` guidance for repeated restart failures and health fetch failures.

`documentations/content/docs/troubleshooting/chronicle.mdx`:

- Replaced the generic `Common causes` table with `Status table`.
- Documented the `GET /chronicle/status` response fields.
- Added rows for:
  - `available=false`
  - `running=false`
  - `lastExitCode`
  - `lastError`
  - `Chronicle daemon failed to start`
  - `[Chronicle error - no API key available for profile]`
  - `[Chronicle error - Chronicle is not enabled]`
  - `totalSnapshots=0`
  - `totalSummaries=0`
  - `macOS capture is only available on macOS`
  - `macOS capture provider is only available on macOS`
  - `CGDisplayCreateImage returned null. Grant Screen Recording permission.`
  - `another Chronicle instance is already running (lock held)`
  - `another Chronicle instance is already running (lock file exists)`
  - `cradle chronicle capture error: ...`
  - `cradle chronicle summary error: ...`
- Added timeline and memory checks to distinguish ingest/UI issues from model/profile issues.

## Risks

- Some recovery steps still depend on the current desktop packaging and log export behavior, so the pages avoid promising a fixed install path or log path.
- `macOS capture is only available on macOS` and `macOS capture provider is only available on macOS` are both documented because both strings exist in adjacent Chronicle code paths. Future cleanup may consolidate these messages.
- The documentation now references `GET /chronicle/status`; if the endpoint is renamed later, this page must be updated with the API docs.

## Validation Recommendations

Run:

```bash
cd documentations
pnpm types:check
pnpm build
```

Manual review:

- Confirm both troubleshooting pages render tables without MDX escaping issues.
- Confirm ReviewH's required message/status keys are present.
- Confirm no non-scope files were changed by this fix.
