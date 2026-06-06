# Native Desktop Private Release Audit B

Scope: macOS native bridge, native services, Mac Bridge protocol, tray, quit guard, notification center, and desktop-owned server process integration.

Exclusions: notarization, signing, certificate, and distribution credential issues.

Workspace state: audited current working tree on 2026-06-06. Desktop/native files already had unrelated local modifications; this audit did not change source files.

## Summary

Private release is not ready for native desktop testing without addressing the quit/server lifecycle and macOS permission discoverability issues. Focused desktop main tests pass, but they mostly cover mocked happy paths and do not exercise real macOS permission, notification authorization, tray quit UX, or detached server shutdown semantics.

Focused command run:

- `pnpm --filter @cradle/desktop exec vitest run src/main/tray-manager.test.ts src/main/quit-guard.test.ts src/main/notification-center-manager.test.ts src/main/mac-bridge-manager.test.ts`
- Result: 4 files passed, 19 tests passed.

## Findings

### 1. Severity: Blocker - Tray Quit Is Intercepted By The Double Command-Q Guard

Evidence:

- `apps/desktop/src/main/tray-manager.ts:167` calls `app.quit()` directly for the tray `quit` action.
- `apps/desktop/src/main/main-app.ts:446` routes every `before-quit` through `quitGuard.handleBeforeQuit(event)`.
- `apps/desktop/src/main/quit-guard.ts:12` defaults `requireDoubleCommandQToQuit` to `true`.
- `apps/desktop/src/main/quit-guard.ts:48` prevents the first quit request and only broadcasts `desktop:quit-guard-armed` to renderer windows.
- There is no `quitGuard.allowNextQuit()` path wired into `TrayManager`.

Impact:

The tray menu item labeled `Quit Cradle` does not reliably quit. On the first click it arms the guard, closes the tray menu, and sends feedback to the renderer. If the main window is hidden, private testers likely see no feedback and conclude Quit is broken. A second tray quit within 2 seconds would require reopening the tray menu fast enough, which is not a reasonable release UX.

Confidence: High.

Recommended release gate:

- Explicit tray quit should bypass the Command-Q guard, or the tray menu should expose a visible two-step confirmation that does not depend on a hidden renderer window.

### 2. Severity: High - Normal App Quit Leaves The Server Process Running

Evidence:

- `apps/desktop/src/main/main-app.ts:446` handles `before-quit`.
- `apps/desktop/src/main/main-app.ts:451` calls `shutdownDesktopRuntime({ stopServerRuntime: false })`.
- `apps/desktop/src/main/main-app.ts:294` calls `detachServer()` when `stopServerRuntime` is false.
- `apps/desktop/src/main/server-process.ts:169` forks the server with `detached: true`.
- `apps/desktop/src/main/server-process.ts:216` only disconnects/unrefs the child and intentionally leaves the CLI locator in place.
- `apps/desktop/src/main/server-process.ts:59` reuses any healthy located server on next desktop launch.

Impact:

Quitting the app can leave a local Cradle server alive on `127.0.0.1`, continuing background tasks and keeping the data directory active after the visible app is gone. That may be intentional for active runs, but private testers will experience it as "Quit does not fully quit", possible stale background work, unexpected notifications, and confusing relaunch behavior. There is also no visible release UX that distinguishes "quit UI but keep server/runs alive" from "fully stop Cradle".

Confidence: High.

Recommended release gate:

- Define and expose an explicit lifecycle contract before private release: either normal Quit stops the desktop-owned server, or the app provides a clearly labeled resident/server mode with a visible stop action and tester-facing docs.

### 3. Severity: High - macOS Native Permissions Are Exposed But Not Discoverable In Product UI

Evidence:

- Swift bridge implements permission status/request/settings methods at `apps/desktop/native/macos/mac-bridge/Sources/CradleMacBridge/main.swift:503` and `apps/desktop/native/macos/mac-bridge/Sources/CradleMacBridge/main.swift:566`.
- Electron native services expose `getPermissions`, `requestPermissions`, and `openPermissionSettings` at `apps/desktop/src/main/native-services.ts:679`.
- `apps/desktop/src/main/main-app.ts:385` starts the Mac Bridge and configures the both-Command hotkey at startup; failure is only logged at `apps/desktop/src/main/main-app.ts:389`.
- Web has typed IPC methods in `apps/web/src/lib/electron.ts:441`, but settings UI only covers double Command-Q, updates, and CLI integration in `apps/web/src/features/settings/desktop-update-settings.tsx:187`.
- Search found no product UI consumer for `nativeIpc.macCapture.getPermissions`, `requestPermissions`, or `openPermissionSettings`.

Impact:

Private testers using Appshot/global hotkey/window capture have no obvious way to see or grant Accessibility, Input Monitoring, or Screen Recording permissions. Startup hotkey setup can fail silently except for console logs. The first visible signal may be a failed capture toast after the tester tries the feature, with no guided recovery path.

Confidence: High.

Recommended release gate:

- Add a Desktop permissions section that reads Mac Bridge permission status, requests required permissions, and opens the exact System Settings pane for denied states.
- At minimum, surface a blocking banner before enabling Appshot/hotkey features when required permissions are denied.

### 4. Severity: High - Appshot Hotkey Can Target A Stale Window Within The Same App

Evidence:

- `FrontmostWindowTracker.start()` records the current app once and subscribes only to `NSWorkspace.didActivateApplicationNotification` at `apps/desktop/native/macos/mac-bridge/Sources/CradleMacBridge/main.swift:115`.
- The hotkey handler emits `targetWindow` from `frontmostWindowTracker.readLastWindowTargetPayload()` at `apps/desktop/native/macos/mac-bridge/Sources/CradleMacBridge/main.swift:352`.
- Same-application window focus changes are not observed by this tracker; there is no focused-window AX observer in the Mac Bridge hotkey path.
- Renderer hotkey capture uses `event?.targetWindow` at `apps/web/src/features/chat/use-composer-appshot-capture.ts:313`, so the stale target can be passed directly to native capture.

Impact:

If a tester switches between multiple Safari/Chrome/Terminal windows without changing the active application, the both-Command Appshot hotkey can capture the previously recorded window rather than the currently focused one. That is a high-trust native bridge feature, so wrong-window capture is a private-release blocker for tester confidence and privacy expectations.

Confidence: Medium-high.

Recommended release gate:

- Resolve the target window at hotkey time, not only at application activation time.
- Prefer an Accessibility focused/main window lookup or a fresh CoreGraphics inventory match when the hotkey fires.

### 5. Severity: Medium - Notification Center Has No Authorization Or Fallback Path

Evidence:

- `NotificationCenterManager.start()` only starts a poll interval at `apps/desktop/src/main/notification-center-manager.ts:65`.
- `showCompletionNotification()` creates and shows Electron `Notification` directly at `apps/desktop/src/main/notification-center-manager.ts:115`.
- The manager does not check `Notification.isSupported()`, does not request/check notification permission, and does not expose an in-app fallback.
- `poll()` calls `rememberRun(run.runId)` before `showCompletionNotification(run)` at `apps/desktop/src/main/notification-center-manager.ts:102`, so a run is considered seen even if native display is blocked or ineffective.

Impact:

On tester machines where macOS notifications are disabled, unsupported, or not yet authorized, completed-run notifications and inline replies can disappear silently. Because run IDs are marked seen before display is verified, the same completion is not retried. This weakens the private-release notification center surface and makes reply-from-notification hard to validate.

Confidence: Medium.

Recommended release gate:

- Check notification support/authorization before polling or before marking runs seen.
- Provide an in-app fallback queue or tray badge for completed runs when OS notifications are unavailable.

## Non-blocking Notes

- Mac Bridge process management has useful mocked coverage for NDJSON request/response, missing binary behavior, hotkey event parsing, and dev binary restart.
- Tray manager has mocked coverage for menu structure, degraded offline tray data, payload forwarding, pending action queue, and quit action dispatch.
- Quit guard has mocked coverage for default double-quit behavior and programmatic bypass.
- Notification center has mocked coverage for completed-run notification creation, idle reply start, and busy-session queueing.

These tests are valuable but should not be treated as private-release readiness for real macOS behavior.
