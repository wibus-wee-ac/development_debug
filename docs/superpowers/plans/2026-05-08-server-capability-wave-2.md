# Server Capability Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the next server-owned HTTP capabilities needed to unblock the Cradle Tsuki migration: workflow rules and agent runtime profiles.

**Architecture:** Extend `apps/server` using the existing Tsuki module pattern with capability-owned stores/helpers and no Electron compatibility code. Keep filesystem ownership under `CRADLE_DATA_DIR`, add a server-side credential cipher boundary, and expose profile/provider operations through HTTP controllers.

**Tech Stack:** Tsuki/Hono, Drizzle SQLite, Vitest, Node fs/promises, node:crypto AES-256-GCM

---

### Task 1: Write workflow-rules capability tests

**Files:**
- Create: `apps/server/tests/workflow-rules.test.ts`
- Modify: `apps/server/tests/README.md`

- [ ] **Step 1: Write failing HTTP integration tests for workflow rules**
- [ ] **Step 2: Run `cd apps/server && pnpm test -- workflow-rules.test.ts` and verify failure due to missing routes**

### Task 2: Implement workflow-rules module

**Files:**
- Create: `apps/server/src/modules/workflow-rules/workflow-rules.module.ts`
- Create: `apps/server/src/modules/workflow-rules/workflow-rules.controller.ts`
- Create: `apps/server/src/modules/workflow-rules/workflow-rules.service.ts`
- Create: `apps/server/src/modules/workflow-rules/workflow-rules.store.ts`
- Create: `apps/server/src/modules/workflow-rules/workflow-rules.config.ts`
- Create: `apps/server/src/modules/workflow-rules/README.md`
- Modify: `apps/server/src/app.module.ts`

- [ ] **Step 1: Implement config/store/service/controller with filesystem ownership under `CRADLE_DATA_DIR/workflow-rules`**
- [ ] **Step 2: Run workflow-rules tests and make them pass**

### Task 3: Write agent-runtime-profiles capability tests

**Files:**
- Create: `apps/server/tests/agent-runtime-profiles.test.ts`
- Modify: `apps/server/tests/README.md`

- [ ] **Step 1: Write failing HTTP integration tests covering profiles, probe/listModels, and credentials**
- [ ] **Step 2: Run `cd apps/server && pnpm test -- agent-runtime-profiles.test.ts` and verify failure due to missing routes**

### Task 4: Implement agent-runtime-profiles module

**Files:**
- Create: `apps/server/src/modules/agent-runtime-profiles/agent-runtime-profiles.module.ts`
- Create: `apps/server/src/modules/agent-runtime-profiles/agent-runtime-profiles.controller.ts`
- Create: `apps/server/src/modules/agent-runtime-profiles/agent-runtime-profiles.service.ts`
- Create: `apps/server/src/modules/agent-runtime-profiles/agent-runtime-profiles.store.ts`
- Create: `apps/server/src/modules/agent-runtime-profiles/agent-runtime-provider-catalog.ts`
- Create: `apps/server/src/modules/agent-runtime-profiles/server-credential-cipher.ts`
- Create: `apps/server/src/modules/agent-runtime-profiles/types.ts`
- Create: `apps/server/src/modules/agent-runtime-profiles/README.md`
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/.env`

- [ ] **Step 1: Implement profile stores, provider registry, service error mapping, and credential cipher**
- [ ] **Step 2: Run agent-runtime-profiles tests and make them pass**

### Task 5: Update migration specs and verify the whole package

**Files:**
- Modify: `apps/server/specs/capabilities/index.md`
- Modify: `apps/server/tests/README.md`
- Modify: `apps/server/README.md` (create if missing)

- [ ] **Step 1: Mark implemented capability statuses and document new server modules**
- [ ] **Step 2: Run `cd apps/server && pnpm test && pnpm typecheck && pnpm build`**
- [ ] **Step 3: Fix any regressions until all commands pass**
