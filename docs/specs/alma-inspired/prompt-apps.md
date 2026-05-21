<!--
Input: Alma Prompt Apps renderer/preload evidence and Cradle automation/skills audit.
Output: Spec for Prompt Apps and runner.
Position: docs/specs/alma-inspired/prompt-apps.md
-->

# Prompt Apps

## Goal

Cradle should support user-authored prompt mini-apps that package a prompt, typed inputs, runtime configuration, optional tools, and execution history into reusable one-click workflows.

## Alma Evidence

Alma has `PromptAppsManager`, `prompt-app-runner.html`, `promptAppRunner` preload, dynamic placeholders, file/image inputs, global shortcuts, model/tool/reasoning settings, execution history, and image-result retry logic.

## Cradle Current State

Cradle has automation definitions, skills, slash commands, and chat runtime, but no prompt app CRUD or independent runner surface.

## Target Ownership

Future `apps/server/src/modules/prompt-apps` owns prompt app definitions, input schema, execution records, and shortcut metadata. `chat-runtime` owns actual generation. Web owns management and runner UI. Desktop owns optional runner windows and shortcuts.

## Target Behavior

- Users can create, edit, enable, disable, duplicate, delete, and reorder Prompt Apps.
- Inputs support text, textarea, select, number, checkbox, file, and image.
- A run creates or resumes a normal Cradle chat session with provenance metadata.
- History records inputs, output session, status, and errors.

## API Sketch

- `GET /prompt-apps`
- `POST /prompt-apps`
- `PUT /prompt-apps/:id`
- `DELETE /prompt-apps/:id`
- `POST /prompt-apps/:id/run`
- `GET /prompt-apps/:id/runs`

## Data Model

Tables should include `prompt_apps`, `prompt_app_inputs`, `prompt_app_runs`, and optional shortcut records. File/image inputs should reference Cradle-owned asset records, not arbitrary temp paths.

## Acceptance

- Running a Prompt App produces a normal chat session and usage record.
- Required inputs are validated before generation starts.
- Disabled apps cannot be run from shortcuts or URLs.
