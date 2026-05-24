<!-- Once this directory changes, update this README.md -->

# Features/Composer Toolbar

Shared composer controls for selecting runtime, provider target, provider-owned model, and thinking effort across chat entry points.

## Files

- **cli-tui-agent-selector.tsx**: CLI TUI agent selector for terminal-backed runtime launches.
- **composer-profile-selection.ts**: Composer-owned provider visibility helpers; composer surfaces see enabled provider targets compatible with the selected runtime kind.
- **composer-profile-selection.test.ts**: Regression coverage for hidden disabled providers and runtime/provider compatibility scoping.
- **composer-toolbar.tsx**: Root toolbar component that chooses runtime-specific selectors from `useComposerState`.
- **constants.ts**: Static runtime and thinking effort label options.
- **index.ts**: Barrel exports for the toolbar feature.
- **provider-model-menu.tsx**: Reusable Provider > model > thinking cascading menu content plus the shared current-provider model list; model lists are keyed by provider target id, model search trims surrounding whitespace, and thinking options are filtered by the selected model.
- **provider-model-picker.tsx**: Unified trigger plus `ProviderModelMenu` composition reused by composer surfaces and Jarvis settings.
- **provider-model-selector.tsx**: Composer toolbar state adapter for `ProviderModelPicker`; direct model selection forwards the owning provider target id.
- **provider-model-selector.test.tsx**: Regression coverage for provider-owned model lists in the menu.
- **runtime-selector.tsx**: Runtime kind selector for new chat and capsule composers.
- **types.ts**: Toolbar selection and model-map type definitions.
- **use-composer-state.ts**: Unified composer state hook that resolves provider targets, the currently selected target's cached model map, selected model, CLI TUI agent, thinking effort, and persisted composer choices.
- **use-composer-state.test.tsx**: Regression coverage for persisted composer choices and direct model-to-profile selection.
