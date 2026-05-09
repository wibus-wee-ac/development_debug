<!--
Output: Agent identity capability implementation plan for server migration.
Input: apps/server/specs/capabilities/agent-identity.md.
Position: docs/superpowers/plans.
-->

# Agent Identity Capability (Server Migration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize the server capability namespace and implement the agent identity capability for Tsuki/Hono with filtered list support, avatar URL policy, and provider binding.

**Architecture:** Root `AppModule` imports `CoreModule`, `InfraModule`, and a new `CapabilitiesModule`. Existing `workspace` / `session` capabilities move from `src/modules/*` to `src/capabilities/*`, then `AgentIdentityModule` is added under `src/capabilities/agent-identity` with controller/service/store boundaries.

**Tech Stack:** TypeScript, Tsuki/Hono, Drizzle ORM (better-sqlite3), Vitest.

---

## File Map (Create/Modify)

**Create**
- `apps/server/src/capabilities/README.md`
- `apps/server/src/capabilities/capabilities.module.ts`
- `apps/server/src/capabilities/agent-identity/README.md`
- `apps/server/src/capabilities/agent-identity/agent-identity.module.ts`
- `apps/server/src/capabilities/agent-identity/agent-identity.controller.ts`
- `apps/server/src/capabilities/agent-identity/agent-identity.service.ts`
- `apps/server/src/capabilities/agent-identity/agent-identity.store.ts`
- `apps/server/tests/agent.test.ts`

**Modify**
- `apps/server/src/app.module.ts`
- `apps/server/src/capabilities/session/README.md`
- `apps/server/src/capabilities/workspace/README.md`
- `apps/server/specs/capabilities/agent-identity.md`
- `apps/server/tests/README.md`
- `apps/server/specs/capabilities/index.md`
- `docs/superpowers/plans/README.md`

**Delete**
- `apps/server/src/modules/session/*`
- `apps/server/src/modules/workspace/*`

---

### Task 1: Normalize capability layout before adding new capability

**Files:**
- Create: `apps/server/src/capabilities/README.md`, `apps/server/src/capabilities/capabilities.module.ts`
- Move/Create: `apps/server/src/capabilities/workspace/*`, `apps/server/src/capabilities/session/*`
- Modify: `apps/server/src/app.module.ts`, capability READMEs that reference old paths

- [ ] **Step 1: Create capability root README and aggregator module**
- [ ] **Step 2: Move `workspace` and `session` from `src/modules/*` to `src/capabilities/*`**
- [ ] **Step 3: Update import paths in `AppModule` to import only `CapabilitiesModule`**
- [ ] **Step 4: Update affected README headers/inventories to point at `src/capabilities/*`**
- [ ] **Step 5: Run `pnpm -C apps/server test -- --run tests/workspace.test.ts tests/session.test.ts`**

### Task 2: Add failing agent capability tests

**Files:**
- Create: `apps/server/tests/agent.test.ts`

- [ ] **Step 1: Write integration tests for `/agents` capability (expected to fail initially)**
  - CRUD: create/list/get/update/delete
  - Avatar URL generation on create and recompute on patch
  - Filters: `enabled`, `providerId`
  - Invalid input: missing `name`, `avatarStyle`, `avatarSeed`, `providerId`
  - Invalid provider: FK violation mapped to `agent_profile_not_found`
  - Missing resource: `GET/PATCH` returns `null`
- [ ] **Step 2: Verify tests fail before implementation**

Run:

```bash
pnpm -C apps/server test -- --run tests/agent.test.ts
```

---

### Task 3: Implement agent capability under `src/capabilities/agent-identity`

**Files:**
- Create: `apps/server/src/capabilities/agent-identity/README.md`
- Create: `apps/server/src/capabilities/agent-identity/agent-identity.module.ts`
- Create: `apps/server/src/capabilities/agent-identity/agent-identity.controller.ts`
- Create: `apps/server/src/capabilities/agent-identity/agent-identity.service.ts`
- Create: `apps/server/src/capabilities/agent-identity/agent-identity.store.ts`
- Modify: `apps/server/src/capabilities/capabilities.module.ts`

- [ ] **Step 1: Implement store list/get/create/update/delete around `agents` with filter support**
- [ ] **Step 2: Implement service semantics (avatar URL generation, partial update, FK/AppError mapping)**
- [ ] **Step 3: Implement controller with query/body validation**
- [ ] **Step 4: Register `AgentIdentityModule` in `CapabilitiesModule`**

---

### Task 4: Verify and document

**Files:**
- Modify: `apps/server/tests/README.md`
- Modify: `apps/server/specs/capabilities/index.md`
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Run agent test and full server test suite**

Run:

```bash
pnpm -C apps/server test -- --run tests/agent.test.ts
pnpm -C apps/server test
pnpm -C apps/server typecheck
```

- [ ] **Step 2: Update docs and capability status**
  - Add `agent.test.ts` to test inventory.
  - Mark `agent-identity` as ✅ in capability index after tests pass.
  - Record that `workspace` and `session` now live under `src/capabilities/*`.
