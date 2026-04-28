# Built-in System Workflow & Skills

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintained in accordance with `PLANS.md` at `.agents/skills/execplan/references/PLANS.md`.


## Purpose / Big Picture

After this change, every non-ACP agent chat session in Cradle automatically receives two things it currently lacks:

1. A **system workflow** — a developer-authored, app-bundled set of instructions that tells the agent what Cradle is, what tools it has (Kanban, issues, CLI, workflow rules), and how to use them. Think of it as the "OS-level system prompt" that ships with the binary. The user never sees or edits it.

2. **Built-in skills** — skill files bundled inside the app binary (starting with the existing `cradle-cli` skill). These are injected into the skill catalog alongside user-level and project-level skills, at the lowest priority (user/project skills override them if same-named).

The end result: when a user starts a new chat or delegates an issue, the agent already knows how to use `cradle issue list`, `cradle issue move`, `cradle issue delegate`, etc., without the user having to configure anything. The system workflow tells the agent "you have a CLI skill, read it when you need to manage issues", and the built-in skill provides the actual reference material.

**How to verify**: Start Cradle in dev mode, open the Agent Context devtool panel, start a new chat with an OpenAI-compatible provider. The `systemPrompt` field should contain the system workflow text. The `skillsCatalog` should include `cradle-cli` with a path pointing to the bundled location.


## Progress

- [x] (2026-04-28 12:30Z) Milestone 1: Created `resources/system-workflow.md`, `resources/skills/cradle-cli/SKILL.md`, `src/main/lib/bundled-resources.ts`
- [x] (2026-04-28 12:35Z) Milestone 2: Injected system workflow into chat-engine.ts runStream() — prepended before agent identity prompt, inside non-ACP block
- [x] (2026-04-28 12:38Z) Milestone 3: Added built-in skills tier to scanSkills() — lowest priority, scanned before user and project skills
- [ ] Milestone 4: Validation — awaiting runtime test


## Surprises & Discoveries

(To be recorded during implementation)


## Decision Log

- Decision: System workflow lives in `resources/system-workflow.md`, built-in skills in `resources/skills/{name}/SKILL.md`
  Rationale: The `resources/` directory is already configured as `asarUnpack: resources/**` in electron-builder.yml, meaning these files remain directly accessible on the filesystem at runtime. No new build config needed. This follows the same pattern as `drizzle/` migrations using `extraResources`, but is simpler because `resources/` is already handled by electron-vite's default static copy.
  Date: 2026-04-28

- Decision: System workflow is injected as a prefix to systemPrompt, before Agent identity prompt and skills catalog
  Rationale: Priority order should be: system workflow (developer intent) → agent identity prompt (user-configured personality) → skills catalog (tool awareness). The system workflow is the highest authority — it defines what the app is and the fundamental behavioral rules.
  Date: 2026-04-28

- Decision: Built-in skills are lowest priority in the skill resolution chain
  Rationale: Priority: project-level > user-level > built-in. If a user or project provides a `cradle-cli` skill, it overrides the bundled one. This respects user customization while providing sensible defaults.
  Date: 2026-04-28

- Decision: ACP providers remain excluded — they manage their own context
  Rationale: ACP agents are external processes with their own skill systems. Injecting Cradle's system workflow would conflict with their internal state management.
  Date: 2026-04-28


## Outcomes & Retrospective

(To be recorded upon completion)


## Context and Orientation

Cradle is an Electron desktop app for managing AI agent workflows. The main process (`src/main/`) handles chat sessions, agent runtime, and IPC. The renderer (`src/renderer/`) is the React UI.

### Key files and current behavior

**Chat context assembly** happens in `src/main/lib/chat-engine.ts`, method `runStream()` (around L570-L670). The current injection order is:

1. `systemPrompt` is initialized from `agents.configJson.systemPrompt` (Agent identity)
2. For non-ACP providers, skills are scanned via `scanSkills(workspace.path)` and the catalog is appended to `systemPrompt`
3. History messages are loaded from the DB
4. Everything is passed to `provider.streamTurn({ systemPrompt, history, message })`

**Skills scanning** is in `src/main/lib/skills.ts`. The function `scanSkills(workspacePath?)` currently scans two locations:

1. `~/.agents/skills/` (user-level, lower priority)
2. `{workspacePath}/.agents/skills/` (project-level, higher priority, overrides user-level)

It returns `SkillCatalogEntry[]` with `{ name, description, location }`. The `buildSkillCatalog()` function formats these into a text block appended to the system prompt.

**Resource bundling** is configured in `electron-builder.yml`:

- `asarUnpack: resources/**` ensures `resources/` contents are accessible as files at runtime
- `extraResources` currently only bundles `drizzle/` migrations
- The existing dev/prod path resolution pattern (from `src/main/db/index.ts`): `is.dev ? join(__dirname, '../../resources') : join(process.resourcesPath, 'resources')`

**The `resources/` directory** currently contains only `icon.png`.

**The cradle-cli skill** already exists at `.agents/skills/cradle-cli/SKILL.md` in the project root — but this is a development-time file, not bundled into the distributed app.

### What "system workflow" means

A system workflow is a Markdown document written by the Cradle developer (you) that:

- Introduces the agent to what Cradle is
- Explains the tools available (Kanban boards, issues, CLI, workflow rules)
- Instructs the agent to use specific skills when relevant
- Sets behavioral expectations (e.g., "use the CLI to manage issues, don't hallucinate commands")

This is NOT user-configurable. It ships with the app binary in `resources/system-workflow.md`.


## Plan of Work

### Milestone 1: Bundle system workflow and built-in skills

After this milestone, the `resources/` directory contains the system workflow file and the built-in cradle-cli skill, and both are accessible at runtime in dev and production.

Create `resources/system-workflow.md` with the developer-authored system instructions. Create `resources/skills/cradle-cli/SKILL.md` by copying the existing `.agents/skills/cradle-cli/SKILL.md`.

Create a utility module `src/main/lib/bundled-resources.ts` that exports a `getBundledResourcePath(relativePath: string): string` function, handling the dev vs prod path resolution.

### Milestone 2: Inject system workflow into chat-engine

After this milestone, every non-ACP chat session has the system workflow prepended to its system prompt.

In `chat-engine.ts`'s `runStream()`, before the existing systemPrompt assembly, read `resources/system-workflow.md` and prepend it. The injection order becomes:

1. System workflow (bundled, highest authority)
2. Agent identity prompt (from `agents.configJson.systemPrompt`)
3. Skills catalog (appended last)

### Milestone 3: Inject built-in skills into scanSkills

After this milestone, `scanSkills()` also scans `resources/skills/` as the lowest-priority tier. Built-in skills appear in the catalog but are overridden by user-level or project-level skills with the same name.

Modify `src/main/lib/skills.ts` to accept a `builtinSkillsDir` path and scan it first (lowest priority), then user-level, then project-level.

### Milestone 4: Validation

Start dev mode, open Agent Context devtool, verify system workflow appears in systemPrompt and cradle-cli appears in skills catalog. Run typecheck to confirm no errors.


## Concrete Steps

### Milestone 1

1. Create `resources/system-workflow.md` — the system-level instructions for all agents.

2. Create `resources/skills/cradle-cli/SKILL.md` — copy from `.agents/skills/cradle-cli/SKILL.md` (the built-in skill that teaches agents how to use the CLI).

3. Create `src/main/lib/bundled-resources.ts`:

    Export function `getBundledResourcePath(relativePath: string): string` that returns:
    - Dev: `join(__dirname, '../../resources', relativePath)`
    - Prod: `join(process.resourcesPath, relativePath)`

    Export function `readBundledResource(relativePath: string): string | null` that reads the file at the bundled path, returning null if not found.

### Milestone 2

1. Edit `src/main/lib/chat-engine.ts`:
   - Import `readBundledResource` from `./bundled-resources`
   - In `runStream()`, after `let systemPrompt: string | undefined` (L576), add:

         const sysWorkflow = readBundledResource('system-workflow.md')

   - After loading Agent identity systemPrompt (around L598), prepend the system workflow:

         if (sysWorkflow) {
           systemPrompt = systemPrompt
             ? sysWorkflow + '\n\n' + systemPrompt
             : sysWorkflow
         }

   This ensures system workflow comes before agent-specific prompt, and skills catalog is appended after both.

### Milestone 3

1. Edit `src/main/lib/skills.ts`:
   - Import `getBundledResourcePath` from `./bundled-resources`
   - In `scanSkills()`, add built-in skills as the first (lowest priority) scan:

         const builtinDir = getBundledResourcePath('skills')
         scanDirectory(builtinDir, skillsByName)

   - This goes before the user-level scan, so user and project skills override built-in ones.

### Milestone 4

1. Run `pnpm typecheck:web` and `pnpm typecheck:node` (or equivalent) — no new errors.
2. Start `pnpm dev`, open a chat with an OpenAI-compatible provider.
3. Open Agent Context devtool — verify:
   - `systemPrompt` starts with the system workflow content
   - `skillsCatalog` includes a `cradle-cli` entry with a path under `resources/skills/`
4. Ask the agent "What tools do you have for managing issues?" — it should reference the Kanban/CLI functionality.


## Validation and Acceptance

Start Cradle dev mode with `pnpm dev`. Create or select a workspace. Open a new chat session using an OpenAI-compatible provider (not ACP). Open the Agent Context panel in devtools. The `systemPrompt` field should begin with the content of `resources/system-workflow.md`, followed by any agent identity prompt, followed by the skills catalog. The skills catalog should include `cradle-cli`. Send a message asking the agent about available tools — the response should demonstrate awareness of Kanban, issues, and CLI commands.


## Idempotence and Recovery

All changes are additive — new files only, plus two small edits to existing modules. If the system workflow file is missing at runtime, `readBundledResource()` returns null and the system falls back to the current behavior (no system workflow). If the built-in skills directory is missing, `scanDirectory()` already handles non-existent directories gracefully (returns early).


## Artifacts and Notes

Files created:
- `resources/system-workflow.md`
- `resources/skills/cradle-cli/SKILL.md`
- `src/main/lib/bundled-resources.ts`

Files modified:
- `src/main/lib/chat-engine.ts` (prepend system workflow to systemPrompt)
- `src/main/lib/skills.ts` (add built-in skills scan tier)


## Interfaces and Dependencies

- `getBundledResourcePath(relativePath)` — used by chat-engine.ts and skills.ts
- `readBundledResource(relativePath)` — used by chat-engine.ts
- `electron-builder.yml` already handles `resources/` via `asarUnpack` — no config change needed
- No new npm dependencies
