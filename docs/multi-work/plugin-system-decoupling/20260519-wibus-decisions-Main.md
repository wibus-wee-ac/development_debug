# Plugin System Decisions Addendum

Date: 2026-05-19
Owner: Main agent
Scope: Records Wibus's decisions after the critique-chain synthesis.

## Decisions

Wibus made two architecture decisions for the next Plugin System phase:

- Production should allow external local plugins.
- Canonical plugin identity may use the npm package name.

## Implications

### Production External Local Plugins

Production support for external local plugins means `externalLocal` cannot be treated as a development-only escape hatch. It must become a first-class source kind with explicit governance.

Required policy:

- External local plugin roots must be explicitly configured.
- Production must reject plugins outside configured roots.
- Server and desktop entries from external local plugins must require an explicit trusted source decision.
- Devtool must show `sourceKind`, resolved package path, trust status, enabled layers, and validation warnings.
- Plugin loading failures must never block core startup or other plugins.

Non-goals for the immediate phase:

- No third-party sandbox guarantee.
- No marketplace trust model.
- No remote package installation.

The practical stance is: production may load external local plugins, but they are trusted local code selected by the operator.

### Npm Package Name Identity

Using npm package name as plugin identity is acceptable and fits the current package-based plugin layout.

Required rules:

- `package.json#name` is the canonical plugin identity.
- Missing package name is invalid for v1 plugins.
- Duplicate package names across discovered sources are rejected unless a future override policy is explicitly designed.
- Route short names, storage prefixes, capability ids, and devtool records must be derived from the canonical package name through one shared normalizer.
- Scoped packages must remain distinguishable after normalization.

Recommended derived names:

- Canonical id: `@cradle/browser-use`
- Route segment: `cradle-browser-use` or another reversible/safely encoded form
- Capability id prefix: `@cradle/browser-use:`
- Storage namespace: `plugin:@cradle/browser-use`

Avoid relying on the current ad hoc stripping behavior as the canonical rule, because `@cradle/plugin-foo`, `@cradle/foo`, and external scoped packages can collide after prefix removal.

## Revised Phase 1 Adjustments

The synthesis recommendation remains valid with these adjustments:

1. `PluginSource` must include production-enabled `externalLocal`.
2. Source policy must validate configured external roots instead of rejecting production external plugins.
3. Manifest v1 should require `package.json#name` as identity rather than adding `cradle.id`.
4. The legacy adapter should reject missing names and warn on names that normalize to colliding route segments.
5. The first implementation pass should include duplicate identity tests and route-segment collision tests.

## Acceptance Gates Added By These Decisions

Before moving experimental features into production external local plugins:

- The plugin source path is under an explicitly configured root.
- The package name is unique across all discovered plugin sources.
- The derived route segment and capability prefix do not collide with another plugin.
- The plugin's source kind and trust status are visible in devtool.
- Disable semantics work for external local plugins in production.

## Open Follow-Up

The remaining design choice is the exact route-segment encoding for npm package names. It should be deterministic, stable, and collision-resistant enough for scoped packages. A reversible encoding is preferable to prefix stripping.
