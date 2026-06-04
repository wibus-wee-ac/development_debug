<!-- Once this directory changes, update this README.md -->

# Composer Slots

Composer-adjacent slot renderers for provider-owned runtime UI state. The parent `composer-slot-states.tsx` owns slot selection by declared `composerState` surface plus bounded ChatView UI actions such as slash-opened usage; files in this directory own the concrete rail UI for each slot kind.

## Files

- **composer-slot-shell.tsx**: Shared compact rail shell and icon action primitive used by composer slot renderers.
- **goal-slot-state.tsx**: Codex goal rail with elapsed time, token budget progress, and goal lifecycle actions.
- **review-slot-state.tsx**: Chat-owned Codex review picker opened by the `/review` UI action; builds native review prompts from workspace git state.
- **types.ts**: Shared action contracts passed from ChatView into composer slot renderers.
- **usage-slot-state.tsx**: Slash-opened ChatGPT account usage rail backed by provider-projected rate-limit windows, percentages, reset timestamps, credits, and a user close action.
