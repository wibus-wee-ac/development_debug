<!-- Once this directory changes, update this README.md -->

# Features/Composer Toolbar

Shared composer controls for selecting runtime, provider profile, provider-owned model, and thinking effort across chat entry points.

## Files

- **cli-tui-agent-selector.tsx**: CLI TUI agent selector for terminal-backed runtime launches.
- **composer-toolbar.tsx**: Root toolbar component that chooses runtime-specific selectors from `useComposerState`.
- **constants.ts**: Static runtime and thinking effort label options.
- **index.ts**: Barrel exports for the toolbar feature.
- **provider-model-selector.tsx**: Provider > model > thinking cascading menu; model lists are keyed by profile id so hovering any provider uses that provider's own visible models.
- **provider-model-selector.test.tsx**: Regression coverage for provider-owned model lists in the menu.
- **runtime-selector.tsx**: Runtime kind selector for new chat and capsule composers.
- **types.ts**: Toolbar selection and model-map type definitions.
- **use-composer-state.ts**: Unified composer state hook that resolves provider profiles, per-profile model maps, selected model, CLI TUI agent, and thinking effort.
