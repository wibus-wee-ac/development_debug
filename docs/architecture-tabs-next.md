# Tabs Next Architecture

## Direct Conclusion

`@cradle/tabs-next` models a tab as a retained navigation context:

```ts
Tab = identity + route history + render policy + view snapshots
```

It is not a page registry and it is not a data cache. Page semantics belong to route owners. Business data belongs to React Query or domain stores. The tab runtime only coordinates how multiple route contexts coexist.

## React Principles

### UI is a function of state

The route owner describes what a location means. The tab runtime describes which location is active in each tab. Rendering follows from those two pieces of state.

### Component identity is the state-retention boundary

Each tab has a stable `tab.id`. `<TabRenderer>` uses that identity to decide when React should preserve or discard a subtree. React `<Activity>` is used only by the `activity-pool` policy; it is not part of the tab data model.

### Effects synchronize external systems

The runtime avoids using component effects as the source of truth for tab identity, active selection, or history. Effects can still fetch data or update route-owned metadata, but the durable tab state lives in the store.

## Layering

### Route Owners

Route owners provide:

- route id
- params
- component
- display metadata
- restore checks
- optional status/layout capabilities

During the prototype migration, `defineTab()` maps the old Cradle tab definitions into this shape.

### Tab Runtime

The runtime owns:

- `tabs`
- `activeTabId`
- `contexts`
- tab-local history
- keep-alive policy
- persisted restore validation
- view-state snapshot slots

### Data Layer

The runtime does not store domain data. Route loaders and React Query should preload or cache data. This prevents Activity eviction from deleting business data and avoids double-writing state into both tab and domain stores.

### Render Manager

`TabRenderer` accepts a render policy:

- `single`: mount only the active tab.
- `activity-pool`: mount active, pinned, and recently active tabs up to a bounded pool.

Desktop should use `activity-pool` with a small maximum. Web can use `single`.

## Migration Strategy

1. Add `@cradle/tabs-next` alongside `@cradle/tabs`.
2. Switch the app imports to the compatibility surface.
3. Keep current tab definitions working through `defineTab()`.
4. Move page metadata into route-owned capabilities.
5. Replace compatibility actions with route-location navigation.
6. Remove the old `@cradle/tabs` package after all route owners are migrated.

## Current Prototype Scope

Implemented:

- context-backed tab history
- fresh-tab creation separate from deduped open
- active tab repair during restore
- unknown route filtering during restore
- Activity pool retention policy
- old `TabBar`, `TabRenderer`, `TabsProvider`, and `useTabsContext` compatibility exports

Not implemented yet:

- TanStack Router adapter
- route-owned status/layout capability consumers in the Cradle chrome
- preloading bridge into React Query
- persisted view-state capture on Activity eviction

Those should be implemented after the prototype proves the navigation-context model inside the app.
