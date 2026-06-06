<!-- Once this directory changes, update this README.md -->

# Cradle v0.0.1-preview.1 Release Notes

This preview is a local-first desktop release for validating Cradle's first-run workflow, workspace-backed chat, manual support lifecycle, and the Electron Builder generic update path before wider distribution.

Private testers should use the [Private Release Tester Guide](./private-release-tester-guide.md) as the install, first-launch, diagnostics, feedback, update, and uninstall checklist.

## What Works In This Preview

- Fresh start from an empty profile shows real empty states rather than fake tasks or fake artifacts.
- New Chat explains missing setup steps and links to project selection or provider setup.
- A configured OpenAI-compatible provider can create a workspace-backed chat session and export that session as Markdown.
- Settings Support provides manual diagnostics export, feedback template copy, feedback channel open, Cradle-owned data reveal, and uninstall data-retention guidance.
- Preview update checks are available only in packaged builds produced with `CRADLE_DESKTOP_UPDATE_URL` pointing at an Electron Builder generic update feed.

## Data Ownership

Cradle-owned data is stored in the app data directory and is retained by default when the app is uninstalled. User workspaces and other external namespaces remain non-Cradle-owned. When Cradle writes outside Cradle-owned storage, the relevant workflow must require explicit confirmation or an approval prompt that names the target path and owner boundary.

## Feedback, Diagnostics, And Errors

This preview does not upload diagnostics automatically. Use Settings Support to export diagnostics locally, review the file, copy the feedback template, and attach only the information you want to share.

## Sharing

Chat sessions can be exported as Markdown. Exported content is intended to be usable outside Cradle, but users should still review it before sharing because prompts and responses may contain project context.

## Uninstall

Use the platform's normal uninstall path to remove the app. Cradle-owned user data is retained by default so local work is not destructively removed. Settings Support and the user documentation describe where retained data lives and how to delete it manually.

## Distribution Status

Before public distribution, the preview artifacts must pass the distribution gate:

- macOS app signed with Developer ID, not ad-hoc signing.
- macOS setup package signed with Developer ID Installer.
- App and setup package notarized and stapled.
- A real `/Applications` installer smoke test proves first run, update check/download/apply when an update feed is configured, support/export, and uninstall documentation from the installed app.
