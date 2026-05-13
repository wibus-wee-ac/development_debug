---
name: multi-work
description: Multi-agent parallel execution with independent review/fix loops. Use when a task can be decomposed into independent units that benefit from isolated context and parallel execution with review gates.
---

# Multi-Work

## Workflow

```
Main Agent
  │
  ├─ Decompose task into independent units (DAG)
  │
  ├─ Parallel execution when dependencies allow
  │    │
  │    ├─ Worker A ── Review A ── pass ─────────┐
  │    │                                        │
  │    ├─ Worker B ── Review B ── fail ── Fix B ── Re-review B ──┐
  │    │                                                        │
  │    └─ Worker C ── Review C ── pass ─────────┐               │
  │                                             │               │
  ├─────────────────────────────────────────────┴───────────────┤
  │
  ├─ Merge results
  │
  ├─ Final integration review
  │
  └─ report
```

Per-node loop:

```
Main Agent
  ├─ spawn Implementation Agent
  │    input: Plan File + related files + assigned task
  │
  ├─ spawn Review Agent
  │    input: Plan File + related files (let sub agent use git diff to discover changes)
  │
  ├─ if review fails:
  │    spawn Fix Agent
  │      input: Plan File + related files + review output
  │      output: fixed artifact + fix summary
  │
  ├─ optional re-review after fix
  │
  └─ continue to merge when all nodes pass
```

## Rules

1. Main Agent owns Plan File, Workflow, merge, and report.
2. Sub agents start with empty context.
3. Spawn prompt should be thin:
   - role
   - assigned task node
   - Plan File reference
   - related file references
4. Do not teach sub agents how to solve the task.
   Do not prescribe implementation strategy unless required.
   Do provide objective acceptance criteria, constraints, and output contract.
5. Sub agents must read Plan File and related files themselves.
6. Parallelize nodes with no dependency edge.
7. Review each completed node independently.
8. Fix only failed review results.
   If still failing, escalate to Main Agent with unresolved issues.
9. If a failed review reveals an architectural issue, Fix Agent must not patch around it. It must return an Architecture Escalation Report to Main Agent.
10. Main Agent owns all architecture-level changes.
11. Only Main Agent report to user.
