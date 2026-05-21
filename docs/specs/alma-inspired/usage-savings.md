<!--
Input: Alma usage/RTK savings evidence and Cradle usage audit.
Output: Spec for usage and savings analytics.
Position: docs/specs/alma-inspired/usage-savings.md
-->

# Usage And Savings Analytics

## Goal

Cradle should extend existing usage reporting only where it improves user decisions about agents, models, and workflows.

## Alma Evidence

Alma has usage settings, activity calendar, daily savings chart, command breakdown, efficiency gauge, and RTK savings settings.

## Cradle Current State

Cradle has token/cost usage logs, daily summaries, model/agent breakdowns, and a usage dashboard with heatmap and charts. It does not have RTK-style savings or command efficiency metrics.

## Target Ownership

`usage` owns token/cost accounting. `automation`, `chat-runtime`, and `issue-agent` may contribute run metadata. Any savings model must be explicit and versioned.

## Target Behavior

- Usage dashboard shows cost, token, model, agent, and workflow breakdowns.
- Optional savings metrics define baseline assumptions and confidence.
- Command/tool breakdown uses structured runtime events, not fragile text parsing.

## API Sketch

- Existing usage endpoints remain canonical.
- Future `GET /usage/savings` can return baseline, actual, estimated savings, confidence, and method version.

## Data Model

Store savings snapshots separately from raw usage to avoid rewriting history when assumptions change.

## Acceptance

- Savings metrics clearly show methodology.
- Missing pricing data does not corrupt existing cost totals.
- Users can filter usage by agent, model, workspace, and session.
