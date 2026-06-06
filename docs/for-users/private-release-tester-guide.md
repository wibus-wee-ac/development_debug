# Private Release Tester Guide

This guide is the invite-to-feedback path for Cradle private testers. It covers installing a private build, completing the first successful session, collecting diagnostics, and sending actionable feedback.

## 1. Before You Install

Use only the artifact link sent in the private invite. The invite must state:

- Version and build date.
- Platform and architecture, for example macOS Apple Silicon, macOS Intel, Windows x64, or Linux x64.
- Signing and notarization status.
- Whether automatic updates are enabled for this build.
- The feedback channel to use.

If the invite does not name your platform, do not install a nearby-looking artifact.

## 2. Install

macOS:

1. Download the `.dmg` or `.zip` artifact named in the invite.
2. Open the artifact and move `Cradle.app` to `/Applications`, unless the invite explicitly asks you to test another location.
3. Launch Cradle from `/Applications`.
4. If the private build is unsigned or not notarized, macOS may block the first launch. Only use the documented bypass from the invite, and include the exact warning text in your feedback.

Windows:

1. Download the `.exe` installer or `.zip` artifact named in the invite.
2. Run the installer, or unzip to a writable local folder.
3. Launch Cradle from the installed app entry.
4. If SmartScreen blocks the build, capture the warning and follow the invite-specific instruction.

Linux:

1. Download the `.AppImage` or `.deb` artifact named in the invite.
2. For AppImage, mark it executable before launch.
3. For deb, install it through your normal package manager.
4. Launch Cradle from the desktop entry or terminal.

## 3. First Launch Checklist

Complete these steps before testing secondary features:

1. Launch Cradle and wait for the main window to appear.
2. Open `Settings > Providers`.
3. Add one provider profile you can actually use. For OpenAI-compatible providers, enter the base URL, API key, and model name from your provider.
4. Open `Settings > Agents` and bind an agent to that provider profile and model.
5. Add a local repository as a workspace from the sidebar project action.
6. Open `New Chat`, select the workspace, agent or provider, and model.
7. Send a short prompt that does not include secrets, for example: `Summarize this repository in three bullets.`
8. Confirm that the response streams, finishes, and remains visible after reopening the session.
9. Export the session as Markdown and inspect the file before sharing it.
10. Quit Cradle, relaunch it, and confirm the workspace, provider profile, and recent session are still present.

## 4. Optional Private-Test Areas

Only spend time here after the first launch checklist passes:

- Kanban: create a board, add an issue, and reopen it after relaunch.
- CLI: while Cradle is running, run `cradle --help` or a command named in the invite.
- Browser/plugin workflows: test only the flows named in the invite, and include the URL, action sequence, and observed result.
- Usage: after at least one successful model response, confirm the usage view shows recent activity.
- Support: verify diagnostics export and feedback template copy.

## 5. Updates

Automatic updates are enabled only when the private invite says an update feed is configured. If the invite says updates are out of scope, do not treat the absence of update prompts as a bug.

When update testing is in scope:

1. Record the installed version before updating.
2. Trigger or wait for the update path described in the invite.
3. Record the new version after relaunch.
4. Confirm local workspaces, provider profiles, and recent sessions remain present.
5. Report whether the update appeared to use a full package, a differential path if available, or an unclear path.

## 6. Diagnostics And Feedback

Cradle does not upload diagnostics automatically in this preview. Send diagnostics manually only after reviewing them.

1. Reproduce the issue once.
2. Open `Settings > Support`.
3. Click `Export` to save a diagnostics JSON file.
4. Open the JSON and remove local paths, repository names, provider errors, prompts, or responses you do not want to share.
5. Click `Copy` to copy the feedback template.
6. Send the template, the exact steps, screenshots if helpful, and the reviewed diagnostics file through the feedback channel named in the invite.

Useful feedback includes:

- Build version, platform, and architecture.
- Whether this was a fresh install or update.
- Exact steps to reproduce.
- Expected result.
- Actual result.
- Whether relaunching Cradle changed the result.
- Whether diagnostics were attached.

## 7. Data Retention And Uninstall

Cradle is local-first. Cradle-owned app data is stored in the operating system app data directory and is retained by default after uninstall so local work is not destroyed accidentally.

Use `Settings > Support > Reveal` to inspect the Cradle-owned data directory. This directory can contain local database files, server logs, provider profile metadata, plugin/runtime state, and observability buffers.

To uninstall:

1. Quit Cradle.
2. Remove the app through the normal platform uninstall path.
3. Delete the Cradle-owned data directory only if you intentionally want to remove local Cradle state.

Do not delete your repository workspace unless you separately intend to delete your own project files. Workspace repositories are not Cradle-owned data.
