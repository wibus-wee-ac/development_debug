<!-- Once this directory changes, update this README.md -->

# Features/Composer Toolbar

Shared composer controls for selecting runtime, provider profile, provider-owned model, and thinking effort across chat entry points.

## Files

- **cli-tui-agent-selector.tsx**: CLI TUI agent selector for terminal-backed runtime launches.
- **composer-toolbar.tsx**: Root toolbar component that chooses runtime-specific selectors from `useComposerState`.
- **constants.ts**: Static runtime and thinking effort label options.
- **index.ts**: Barrel exports for the toolbar feature.
- **provider-model-menu.tsx**: Reusable Provider > model > thinking cascading menu content; model lists are keyed by profile id, model search trims surrounding whitespace, and thinking options are filtered by the selected model.
- **provider-model-picker.tsx**: Unified trigger plus `ProviderModelMenu` composition reused by composer surfaces and Jarvis settings.
- **provider-model-selector.tsx**: Composer toolbar state adapter for `ProviderModelPicker`; direct model selection forwards the owning profile id.
- **provider-model-selector.test.tsx**: Regression coverage for provider-owned model lists in the menu.
- **runtime-selector.tsx**: Runtime kind selector for new chat and capsule composers.
- **types.ts**: Toolbar selection and model-map type definitions.
- **use-composer-state.ts**: Unified composer state hook that resolves provider profiles, per-profile model maps, selected model, CLI TUI agent, thinking effort, and persisted composer choices.
- **use-composer-state.test.tsx**: Regression coverage for persisted composer choices and direct model-to-profile selection.
