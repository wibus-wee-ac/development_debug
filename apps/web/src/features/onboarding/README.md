# Onboarding

`features/onboarding` owns the development-only first-run overlay, its local preview choreography, and all mock data used to demonstrate Cradle product surfaces. It may read reusable product components from other feature namespaces, but preview state and mock fixtures stay onboarding-owned.

## Files

- **animated-cursor.tsx**: Target-backed cursor animation layer used by the product preview stage. Waypoints resolve against `data-onboarding-target` or `data-testid` inside the onboarding preview root.
- **onboarding-page.tsx**: Overlay shell with localized step copy, language switching, navigation, progress state, and the final bento-style start actions.
- **onboarding-product-preview.tsx**: Mock-data product frame that replays chat, workspace, agent, aside, and CI feed flows using real Cradle UI components where appropriate.
- **onboarding-store.ts**: Zustand-backed onboarding visibility and step state persisted by the onboarding feature.

## Ownership

Onboarding copy is owned by the `onboarding` i18n namespace. Mock files, mock CI status, mock issues, and cursor waypoints are demonstration data owned by this feature; they must not mutate workspace, Git, await, or agent runtime state outside the preview.
