# Issue-Agent Integration: Delegation Model with Agent Activities

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. This document must be maintained in accordance with PLANS.md.


## Purpose / Big Picture

Cradle's Kanban issues currently have no concept of who works on them and no way for agents to interact with them. After this change, issues support a delegation model where a human user remains the responsible assignee while an AI agent is delegated to execute the work. Agents interact with issues natively — changing status, leaving comments, and reporting their reasoning — just like a human team member would, but clearly badged as agents.

This follows Linear's Agent Interaction Guidelines (AIG): agents are first-class workspace members who inhabit the platform natively, disclose their identity, provide instant feedback, expose their internal state transparently, respect requests to disengage, and cannot be held accountable (the human always is).

The user can verify this by:
- Opening an issue and delegating it to an agent profile
- Seeing the agent immediately show a "Thinking..." indicator
- Watching the agent change the issue status to "In Progress" and leave comments as it works
- Viewing the agent's full reasoning/tool calls in an "Agent Session" view
- Re-delegating to a different agent, with the new agent picking up prior context
- Stopping the agent mid-work with a "Stop" action


## Progress

- [x] Milestone 1: Assignee + Delegate fields (DB + service + UI)
- [x] Milestone 2: Comment author identity + Agent Activities (DB + service + UI)
- [x] Milestone 3: Issue context refs
- [ ] Milestone 4: Agent execution on delegate
- [ ] Milestone 5: Agent session activity feed + status updates
- [ ] Milestone 6: Re-delegate / handoff + stop signal


## Surprises & Discoveries

- Migration SQL needed `--> statement-breakpoint` separators for drizzle-orm SQLite migrator. Without them, only the first ALTER TABLE runs and the rest silently fail.
- Full Kanban UI redesign was done mid-implementation following Linear's visual design language: borderless cards with priority bar icons, timeline-style activity feed, CSS Grid columns that auto-fill width, status manager moved to sidebar.


## Decision Log

- Decision: Adopt Linear's delegation model — issue has both `assignee` (responsible human) and `delegate` (executing agent), rather than a single polymorphic assignee field.
  Rationale: Per Linear AIG principle "An agent cannot be held accountable." The human is always accountable. The agent is delegated to carry out tasks. This is clearer than making agents and humans interchangeable in the assignee slot.
  Date: 2026-04-26

- Decision: Agent Activities are a separate immutable log table, not regular comments.
  Rationale: Per Linear's best practice: "Comments may not be reliable to read from, as they are editable and may have changed [...] Instead, rely on Agent Activities as these are frozen-in-time snapshots." Agent activities have typed content (thought, action, response, elicitation, error, prompt) and are append-only. Regular comments remain editable by humans.
  Date: 2026-04-26

- Decision: Agent activities are translated into visible comments automatically, but the canonical record is the activity log.
  Rationale: Mirrors Linear's behavior: "When work is complete, emit an AgentActivity with type response [...] We will automatically create a comment under the comment thread as well." The comment is a projection of the activity for human readability.
  Date: 2026-04-26

- Decision: Support two signals: `stop` (human → agent) and `select` (agent → human).
  Rationale: Per Linear's signal system. `stop` is essential for disengagement. `select` enables agent to present choices to the user (which file to modify, which approach to take). We skip `auth` since our agents are local.
  Date: 2026-04-26

- Decision: Agent should immediately change issue status to "started" when beginning work.
  Rationale: Per Linear best practice: "If your agent is delegated to work on an issue that is not in a started, completed, or canceled status type, move the issue to the first status in started when your agent begins work."
  Date: 2026-04-26

- Decision: First activity must be emitted within 10 seconds of delegation, showing "Thinking..."
  Rationale: Per Linear best practice: "The first response must be sent within 10 seconds of receiving the created event, or the agent will be shown as unresponsive."
  Date: 2026-04-26

- Decision: Scheduled tasks are deferred — not part of this exec plan.
  Rationale: User stated this is low priority for their workflow.
  Date: 2026-04-26


## Outcomes & Retrospective

(To be filled on completion)


## Context and Orientation

Cradle is an Electron desktop app (React renderer, SQLite via drizzle-orm, typed IPC).

Key terms:
- **Assignee**: The human user responsible for an issue. In this single-user desktop app, always "me."
- **Delegate**: The AI agent currently executing work on an issue. Optional — an issue can have no delegate.
- **Agent Activity**: An immutable log entry recording something the agent did or said. Types: thought (internal reasoning), action (tool/API call), response (final output), elicitation (request for human input), error (failure), prompt (human message to agent).
- **Agent Session**: A collection of agent activities for one delegation period on one issue. Similar to a chat session but structured as an activity feed rather than a message thread.
- **Signal**: Metadata on an activity that modifies interpretation. Human signals: `stop`. Agent signals: `select`.

**Existing Kanban system** (fully implemented):
- Tables: `kanban_statuses`, `kanban_boards`, `kanban_milestones`, `kanban_issues`, `kanban_issue_comments`, `kanban_issue_relations` in `src/main/db/schema.ts`
- Service: `KanbanService` in `src/main/services/kanban.ts`
- UI: Board view with DnD, issue side panel with comments, sub-issues, relations in `src/renderer/src/features/kanban/`

**Current `kanban_issues` schema**: id, workspaceId, statusId, milestoneId, parentIssueId, title, description (markdown), priority, labels (JSON), timestamps. Missing: assignee, delegate, context_refs.

**Current `kanban_issue_comments` schema**: id, issueId, content (markdown), createdAt. Missing: author identity.

**Agent profiles** (`agent_profiles` table): fully implemented — id, name, providerKind, enabled, configJson, credentialRef.

**Chat engine** (`src/main/lib/chat-engine.ts`): Orchestrates agent interactions via `ChatRuntimeProvider`.

**Sessions** (`sessions` table): id, workspaceId, agentProfileId, title, timestamps.

Files to be modified:
- `src/main/db/schema.ts` — add delegate/assignee to issues, author to comments, new tables
- `src/main/services/kanban.ts` — extend with delegation and activity methods
- `src/main/lib/chat-engine.ts` — support issue-linked sessions
- `src/renderer/src/features/kanban/issue-panel.tsx` — delegate picker, activity feed
- `src/renderer/src/features/kanban/issue-card.tsx` — delegate badge

Files to be created:
- Migration SQL file
- `src/main/lib/issue-agent-runner.ts` — orchestrates agent execution for delegated issues
- `src/renderer/src/features/kanban/delegate-picker.tsx` — UI for choosing an agent to delegate to
- `src/renderer/src/features/kanban/agent-activity-feed.tsx` — displays agent session activities


## Plan of Work


### Milestone 1: Assignee + Delegate Fields

**Scope:** Add delegation fields to `kanban_issues`, extend `KanbanService`, and build the delegate picker UI.

**Schema changes to `kanban_issues`:**

    assignee_kind TEXT DEFAULT 'user' — 'user' or null; always the human in this single-user app
    assignee_id TEXT DEFAULT '__self__' — sentinel for "me"
    delegate_agent_id TEXT — references agent_profiles.id, nullable (no delegate = human does it manually)
    context_refs TEXT NOT NULL DEFAULT '[]' — JSON array of typed context references (detailed in M3)

**New table: `agent_sessions`**

An agent session represents one period of delegation, containing all the agent's activities for that issue.

    id TEXT PRIMARY KEY
    issue_id TEXT NOT NULL REFERENCES kanban_issues(id) ON DELETE CASCADE
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id)
    chat_session_id TEXT REFERENCES sessions(id) — link to the underlying chat session
    status TEXT NOT NULL DEFAULT 'created' — created, active, completed, stopped, failed
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())

Index on `issue_id`.

**New table: `agent_activities`**

Immutable activity log. Each entry has typed content.

    id TEXT PRIMARY KEY
    agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE
    type TEXT NOT NULL — 'thought', 'action', 'response', 'elicitation', 'error', 'prompt'
    content TEXT NOT NULL — JSON: { body } for most types, { action, parameter, result } for 'action'
    signal TEXT — optional: 'stop', 'select', etc.
    signal_metadata TEXT — optional JSON for signal data (e.g., select options)
    created_at INTEGER NOT NULL DEFAULT (unixepoch())

Index on `agent_session_id`.

**Service changes in `KanbanService`:**

- `delegateIssue(issueId, agentProfileId)` — sets `delegate_agent_id`, creates an `agent_session`, emits system comment "Delegated to {agent name}", returns the agent session ID
- `undelegateIssue(issueId)` — clears `delegate_agent_id`, emits system comment "Delegation removed"
- `getAgentSessions(issueId)` — list all agent sessions for an issue
- `getAgentActivities(agentSessionId)` — list all activities for a session
- `addAgentActivity(agentSessionId, type, content, signal?, signalMetadata?)` — append immutable activity

**UI: Delegate Picker**

A dropdown in the issue panel. Shows:
- "No delegate" (default)
- All enabled agent profiles from `ipc.agentRuntime.listProfiles()`, each with a bot badge icon

On the issue card in the board view, show a small bot badge with the agent's initial letter when delegated.

**Validation:** Open Kanban board, open an issue, delegate to an agent profile. The issue card should show the agent badge. Query `window.ipc.kanban.getAgentSessions(issueId)` — should return the created session.


### Milestone 2: Comment Author Identity + Activity Projection

**Scope:** Add author fields to comments, auto-create comments from agent activities.

**Schema changes to `kanban_issue_comments`:**

    author_kind TEXT NOT NULL DEFAULT 'user' — 'user', 'agent', 'system'
    author_id TEXT — for 'agent': agent profile ID; for 'user': '__self__'; for 'system': null
    agent_activity_id TEXT — optional, links back to the source activity if this comment was auto-created

**Service changes:**

- `addComment` extended with optional `authorKind`, `authorId`, `agentActivityId` params
- When an agent activity of type `response` or `error` is created, automatically create a matching comment with `author_kind='agent'`
- System events (delegate, status change) create comments with `author_kind='system'`

**UI changes in issue panel:**

- Comments show author badge:
  - User: person icon, normal text
  - Agent: bot icon + agent name, normal text
  - System: no icon, muted italic text, smaller
- Agent-authored comments link to the source activity (click to expand full session view)

**Validation:** Manually call `addAgentActivity` with type `response`. Check that a comment was auto-created on the issue with `author_kind='agent'`. Check the issue panel renders it with bot badge.


### Milestone 3: Issue Context Refs

**Scope:** Allow users to attach sessions, files, URLs, and notes as context on issues.

The `context_refs` column was already added in M1. This milestone builds the UI and service methods for managing it.

**Context ref types:**

    { type: 'session', id: string }         — link to a chat session
    { type: 'file', path: string }          — a file path
    { type: 'url', url: string }            — an external URL
    { type: 'note', text: string }          — free-text annotation

**Service methods:**

- `updateContextRefs(issueId, refs)` — replace all refs
- `addContextRef(issueId, ref)` — append one ref
- `removeContextRef(issueId, index)` — remove by index

**UI in issue panel:**

- "Context" section below description
- Each ref rendered by type: session shows title + link, file shows path, URL is clickable, note shows text
- "Add context" dropdown with type options
- Remove button on each ref

**Validation:** Add a session ref and a note to an issue. They appear in the Context section. Remove one — it disappears.


### Milestone 4: Agent Execution on Delegate

**Scope:** When an issue is delegated to an agent, automatically start execution with the issue's full context.

**New file: `src/main/lib/issue-agent-runner.ts`**

`IssueAgentRunner` class:

- `startForIssue(issueId: string, agentSessionId: string)` — called after `delegateIssue`
  1. Immediately emit a `thought` activity: "Reading issue context..." (must be within 10 seconds)
  2. Load the issue (title, description, context_refs)
  3. Load the workspace notes
  4. Load any referenced session summaries
  5. Load prior agent sessions for this issue (for re-delegation context)
  6. Find the first "started" status in the workspace and move the issue to it
  7. Emit another `thought` activity with a brief plan
  8. Create a chat session linked to the issue
  9. Compose an initial message with all context
  10. Run the chat engine — as messages stream back from the agent:
      - Emit `thought` activities for intermediate reasoning
      - Emit `action` activities for tool calls
      - Emit `response` activity for final answer
  11. On completion, transition agent session to `completed`
  12. Optionally move issue status to "completed" if the agent's response indicates done

**Issue status management:**

The runner calls `KanbanService.moveIssue` to change status. Available statuses are fetched from the workspace's `kanban_statuses` — finding ones marked as "started" and "completed" type would require a status type field on `kanban_statuses`. For now, we use a simpler approach: move to the second status (index 1, assumed "In Progress") on start. The agent can explicitly request status changes via tool calls.

**Integration in `KanbanService.delegateIssue`:**

After creating the agent session, call `IssueAgentRunner.startForIssue(issueId, agentSessionId)` asynchronously (don't await — the UI should return immediately while the agent starts).

**Validation:** Delegate an issue with a description to an enabled agent. Observe:
1. Agent session created immediately
2. "Thinking..." thought activity appears within seconds
3. Issue status changes to "In Progress"
4. Agent's chat response appears as activities
5. A comment with the response is auto-created on the issue


### Milestone 5: Agent Session Activity Feed UI

**Scope:** Build the activity feed UI in the issue panel so users can inspect the agent's full reasoning and actions.

**New component: `agent-activity-feed.tsx`**

Renders a timeline of agent activities:
- **Thought** (brain icon, muted): shows the agent's internal reasoning
- **Action** (wrench icon): shows tool name, parameters, result — collapsible
- **Response** (message icon): the agent's output — highlighted
- **Elicitation** (question icon): agent asks the user something — with select options if signal=select
- **Error** (alert icon, red): error message
- **Prompt** (person icon): human message to the agent

Each activity shows a timestamp. The overall agent session shows its status (active with spinner, completed with check, stopped, failed).

**Integration in issue panel:**

- New tab or section: "Agent Session" alongside "Comments"
- If the issue has been delegated, show the latest agent session's activity feed
- If there are multiple agent sessions (from re-delegation), show a dropdown to switch between them
- Active sessions show a live updating feed

**Stop signal:**

A "Stop" button is visible when an agent session is active. Clicking it:
1. Creates a `prompt` activity with signal `stop`
2. The `IssueAgentRunner` detects the stop signal and halts execution
3. Agent session transitions to `stopped`
4. System comment: "Agent stopped by user"

**Validation:** Delegate an issue to an agent. Watch the activity feed update in real-time. Click "Stop" — the agent stops and the session shows as stopped.


### Milestone 6: Re-delegate / Handoff

**Scope:** Re-delegating from one agent to another creates a new agent session with access to prior context.

**How it works:**

1. User opens delegate picker, selects a different agent
2. Current agent session is completed (or stopped if still active)
3. System comment: "Re-delegated from {A} to {B}"
4. New agent session created for agent B
5. `IssueAgentRunner.startForIssue` called — this time with prior session context
6. The context composition step (M4 step 5) includes summaries of previous agent sessions
7. Agent B's initial message includes: "Previous agent ({A name}) worked on this. Summary: {activity summary}"

**Context from prior sessions:**

When composing context for a new delegation, the runner:
1. Loads all agent sessions for this issue, sorted by creation time
2. For each completed/stopped session, extracts `response` and `error` activities
3. Formats them as a brief summary: "Agent {name} ({date}): {response body excerpt}"
4. This becomes part of the initial message to the new agent

**Validation:** Delegate issue to Agent A, let it work and complete. Re-delegate to Agent B. Check that Agent B's initial context includes a summary of Agent A's work. The issue should have system comments for both delegations.


## Validation and Acceptance

The overall feature is accepted when:

1. Issues have a delegate field (agent profile) visible in the issue panel and card
2. Delegating creates an agent session with activities appearing within 10 seconds
3. Agent activities are projected as comments with proper author badges
4. Comments distinguish user, agent, and system authors with visual differences
5. Issues can have context refs (sessions, files, URLs, notes)
6. The activity feed shows the agent's full reasoning chain
7. The "Stop" button halts agent execution
8. Re-delegating passes prior session context to the new agent
9. No regressions in existing Kanban functionality (DnD, status management, sub-issues, relations)


## Idempotence and Recovery

- Migrations use ADD COLUMN for existing tables, CREATE TABLE IF NOT EXISTS for new tables
- Delegating when there's already an active agent session first completes/stops the existing one
- If the app crashes during agent execution, the agent session remains in `active` status. On next startup, stale active sessions (> 30 minutes old) are transitioned to `failed`
- Activity log is append-only — no update or delete operations


## Interfaces and Dependencies

- Internal: `IssueAgentRunner` depends on `KanbanService`, `SessionService`, `ChatEngine`, `AgentRuntimeService`
- IPC: Extends `kanban` group with `delegateIssue`, `undelegateIssue`, `getAgentSessions`, `getAgentActivities`, `addAgentActivity`, context ref CRUD
- Events: `kanban:issue-updated` for delegate changes, new `agent:activity-created` for live feed updates
- Schema: 2 new tables (`agent_sessions`, `agent_activities`), 4 new columns on `kanban_issues`, 3 new columns on `kanban_issue_comments`
- No new npm dependencies


## Artifacts and Notes

- Design follows Linear's Agent Interaction Guidelines (https://linear.app/developers/aig): agent identity disclosure, native platform actions, instant feedback, transparent state, disengagement, human accountability
- Agent Activities (immutable timeline) are the canonical record; comments are projections for human readability
- The activity feed UI should support both collapsed (just responses) and expanded (full reasoning chain) views
- Future: agent activities could be used for evaluation/scoring of agent performance over time
