# Multica-inspired 后续会话恢复 Prompt

下面的 prompt 可用于未来重新启动本调研、进入 ExecPlan，或要求实现其中某个 Multica-inspired 能力。

```text
You are continuing the Multica-inspired architecture work in /Users/wibus/dev/Cradle.

Goal:
- Use /Users/wibus/dev/safe-research/multica as the evidence source, and continue turning Multica's existing and planned features into Cradle SPECs, ExecPlans, or implementation work.
- Do not copy Multica's historical debt. Prefer clear owner and namespace boundaries, unified task lifecycle, separated agent identity and runtime capability, read-only skill materialization, and audited external ingress.
- Write document prose in Simplified Chinese. Use English for code, identifiers, and fenced code blocks.

Read these files first:
- docs/specs/multica-inspired/README.md
- docs/specs/multica-inspired/coverage-matrix.md
- docs/specs/multica-inspired/evidence-map.md
- docs/specs/multica-inspired/feature-inventory.md
- docs/specs/multica-inspired/product-concept-and-domain-model.md
- docs/specs/multica-inspired/runtime-task-execution.md
- docs/specs/multica-inspired/skills-and-agent-templates.md
- docs/specs/multica-inspired/squads-autopilots-and-external-ingress.md
- docs/specs/multica-inspired/clean-cradle-architecture.md

Important external evidence paths:
- /Users/wibus/dev/safe-research/multica/README.md
- /Users/wibus/dev/safe-research/multica/CLAUDE.md
- /Users/wibus/dev/safe-research/multica/CLI_AND_DAEMON.md
- /Users/wibus/dev/safe-research/multica/docs/product-overview.md
- /Users/wibus/dev/safe-research/multica/docs/agent-quick-create-plan.md
- /Users/wibus/dev/safe-research/multica/docs/onboarding-refactor-plan.md
- /Users/wibus/dev/safe-research/multica/docs/timezone-architecture-rfc.md
- /Users/wibus/dev/safe-research/multica/docs/analytics.md
- /Users/wibus/dev/safe-research/multica/server/migrations/
- /Users/wibus/dev/safe-research/multica/server/cmd/server/router.go
- /Users/wibus/dev/safe-research/multica/server/internal/daemon/
- /Users/wibus/dev/safe-research/multica/packages/core/types/

Current core decisions:
- Workspace is the namespace and permission boundary.
- Agent is teammate identity, not provider runtime.
- Runtime is executable capability.
- Task lifecycle is the unified execution source of truth for issue, chat, automation, webhook, squad, and quick-create work.
- Task token must replace long-lived owner or daemon credentials injected into agents.
- Skills are Cradle-owned usage knowledge. Provider-native paths are only per-task materialization.
- Squads are a routing layer, not a parallel writer network.
- Autopilots should belong to the Cradle automation owner.
- External ingress should independently own installation, binding, delivery audit, dedupe, signature, and replay.

If implementation is requested:
1. Inspect the current worktree diff first. Do not overwrite user changes.
2. Pick the smallest owner slice for the target, such as task lifecycle, skills materialization, external ingress, or agent identity/runtime split.
3. Write docs/exec-plans/YYYYMMDD-XX-*.md for the selected slice.
4. The ExecPlan must list canonical entities, owner, API, data migration, UI surface, observability, and tests.
5. Prefer clean breaking upgrades for unreleased internal APIs. Do not add compatibility layers for internal debt.
6. Verify with current Cradle tests, type checks, and documentation greps.
```
