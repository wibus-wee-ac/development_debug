<!--
Input: Alma UI/theme/keybinding settings evidence and Cradle design/preferences audit.
Output: Spec for UI, theme, and keybinding settings.
Position: docs/specs/alma-inspired/ui-theme-keybindings.md
-->

# UI Theme And Keybindings

## Goal

Cradle should keep design-system consistency while exposing practical appearance, editor, terminal, and shortcut preferences.

## Alma Evidence

Alma settings include UI font, terminal font/size/cursor, word wrap, minimap, system caret, tool card expansion, labels, custom theme editing, base30/base16/simple colors, plugin theme card, and keybinding recording for common actions.

## Cradle Current State

Cradle has a design system, appearance settings, desktop update settings, agent/provider settings, and some shortcut-driven UI behavior. It does not expose a full keybinding recorder or theme editor equivalent.

## Target Ownership

`preferences` owns persisted settings. `apps/web` owns design-system-compatible UI. `apps/desktop` owns global shortcut application. Plugins may contribute theme extensions only through governed APIs.

## Target Behavior

- Users can configure theme mode, density, font choices, terminal display, chat rendering preferences, and keybindings.
- Keybinding conflicts are detected.
- Plugin themes cannot override core accessibility constraints.
- Design tokens remain statically defined and compatible with Tailwind rules.

## API Sketch

- `GET /preferences/appearance`
- `PUT /preferences/appearance`
- `GET /preferences/keybindings`
- `PUT /preferences/keybindings`

## Data Model

Preferences store user overrides only. Defaults live in code and design-system docs.

## Acceptance

- Resetting appearance returns to design-system defaults.
- Invalid keybindings are rejected with conflict details.
- Theme changes do not introduce dynamic Tailwind class construction.
