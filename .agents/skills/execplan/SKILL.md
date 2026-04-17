---
name: execplan
description: Create and maintain ExecPlans for complex features or significant refactors. Use when planning work that requires design + implementation steps, especially when the repo requires ExecPlans in docs/exec-plans and strict format per PLANS.md.
---

# ExecPlan

Use this skill when a task is complex enough to require an ExecPlan. Follow the repository rules in `PLANS.md` (locally at `${skillpath}/references/PLANS.md`) exactly.

## Core Rules (Do Not Skip)

- Read `references/PLANS.md` before writing or updating any ExecPlan.
- Write new plans to `docs/exec-plans/` with the filename `YYYYMMDD-<order>-short-description.md`.
- Do not modify existing ExecPlans unless the change is explicitly about documentation fixes.
- ExecPlans are living documents: update Progress, Decision Log, Surprises & Discoveries, and Outcomes & Retrospective as you work.
- If the ExecPlan file contains only the plan, omit triple backticks around the plan body.

## Minimal Workflow

1. Decide if the work is complex enough to require an ExecPlan. If not, do not create one.
2. Read `references/PLANS.md` and summarize the non-negotiables in your own words.
3. Draft the plan in `docs/exec-plans/` using the required sections. Keep it self-contained and novice-friendly.
4. Validate that it includes: Purpose/Big Picture, Progress (with timestamps), Surprises & Discoveries, Decision Log, Outcomes & Retrospective, Context and Orientation, Plan of Work, Concrete Steps, Validation and Acceptance, Idempotence and Recovery, Artifacts and Notes, Interfaces and Dependencies.
5. During implementation, update the plan at every stopping point with concrete progress and new decisions.

## Required Content Guidelines

- Explain user-visible outcomes and how to verify them.
- Specify exact files, commands, and expected outputs.
- Make each milestone independently verifiable.
- Avoid external links for essential knowledge; embed what is needed.
- Add a short revision note at the end of the plan when updating it.

## Naming and Placement

- Always write to `docs/exec-plans/`.
- Use the next sequential order for the day: `01`, `02`, etc.
- Keep the filename short and descriptive.

## Quick Checklist Before Saving

- The plan is self-contained for a novice.
- It uses the required sections from `references/PLANS.md`.
- Progress has timestamps and reflects current state.
- Decision Log and Surprises are up to date.
- Validation steps are concrete and runnable.
