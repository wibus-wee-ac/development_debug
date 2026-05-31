<!-- Once this directory changes, update this README.md -->

# Features/Agent-Runtime

Renderer data hooks for Agent Runtime provider targets, manual provider profiles, Agent identities, and provider-owned model inventory.
This feature exposes provider-target query ownership plus legacy manual profile mutations and Agent entity CRUD to launchers and settings.
Provider execution and credentials remain in the Electron main process.
Model visibility semantics are owned here: missing or empty `enabledModels` means all provider models are visible, the sentinel disables all models, and a non-empty list is an explicit allow-list.

## Files

- **agent-avatar.tsx**: Agent Runtime-owned compact avatar adapter that renders persisted Agent avatar URLs or DiceBear metadata for Kanban and other feature surfaces.
- **avatar-url.ts**: Agent identity DiceBear avatar URL builder shared by settings and feature surfaces.
- **model-visibility.ts**: Shared helpers for interpreting provider model visibility config and filtering model descriptors
- **model-visibility.test.ts**: Unit coverage for default-all, all-disabled, and explicit allow-list model visibility semantics
- **use-agent-profiles.ts**: `useAgentProfiles` hook — legacy manual provider mutation adapter for settings surfaces that still edit manual provider records, invalidating agent, provider-target, profile, and model queries when manual config changes
- **use-agents.ts**: `useAgents` hook — CRUD for Agent identity entities, shared agents query key export, explicit local Claude/Codex import mutation, and query success for settings readiness
- **use-agent-models.ts**: `useAgentModels`, `useProviderTargetModels`, `useAgentModelMap`, and `useProviderTargetModelMap` hooks — read cached visible models for manual provider records and provider targets, share stable query keys across chat, composer, and settings surfaces, and avoid automatic provider inventory refreshes
- **use-provider-targets.ts**: `useProviderTargets` hook — reads unified manual and external provider targets for runtime selection surfaces via generated React Query options
- **runtime-compatibility.ts**: renderer-side runtime-kind to provider-kind compatibility rules used by composer filtering.
