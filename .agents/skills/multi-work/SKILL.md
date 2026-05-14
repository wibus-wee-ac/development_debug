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
  ├─ spawn Exploration Agents to research and plan the assigned task node
  │    input: What user wants
  ├─ collect and synthesize findings into Plan File
  │    output: Plan Files
  │
  ├─ spawn Implementation Agents (Worker A, Worker B, Worker C,...)
  │    input: Plan Files + related files + assigned task
  │
  ├─ spawn Review Agents
  │    input: Plan Files + related files (let sub agent use git diff to discover changes)
  │
  ├─ Note: You can spawn any type of agent anytime, the above are just examples of typical node types. In practice, you can flexibly adjust and combine different types of sub-agents as needed to accomplish the task. By leveraging the independent context and parallel execution capabilities of sub-agents, you can greatly improve the efficiency and quality of handling complex tasks.
  │    
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