<!--
Input: Alma fatigueService evidence and Cradle agent state audit.
Output: Spec for personal fatigue/sleep state.
Position: docs/specs/alma-inspired/fatigue-sleep-state.md
-->

# Fatigue And Sleep State

## Goal

Cradle should only add personal fatigue or sleep state if it has a clear user-facing purpose and consent model.

## Alma Evidence

Alma includes a `fatigueService` chunk that persists fatigue state, message counts, last rest time, manual sleep/wake, and injects awake, tired, sleepy, or sleeping status into prompts.

## Cradle Current State

Cradle has agent/session state, Chronicle, and automation, but no personal fatigue or sleep state owner.

## Target Ownership

A future personal state owner would manage user-controlled state. It must not be hidden inside chat runtime or provider profiles.

## Target Behavior

- Users can opt into personal state tracking.
- State can be manually set to active, resting, or unavailable.
- Prompts receive state only when the user enables it.
- State has clear reset and deletion behavior.

## API Sketch

- `GET /personal-state`
- `PUT /personal-state`
- `POST /personal-state/reset`

## Data Model

Persist state, last updated time, source, and consent version. Avoid inferring health state from private content unless explicitly approved.

## Acceptance

- Disabling personal state removes it from future prompt context.
- Manual state changes are visible and reversible.
- State data can be deleted independently from chat history.
