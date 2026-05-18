# Desktop Plugin Governance Projection Handoff

Date: 2026-05-19
Worker: WorkerC
Scope: Desktop-side plugin discovery and loader projection only

## Changed Files

- `apps/desktop/src/main/plugin-discovery.ts`
  - Added governed desktop discovery result with `PluginDescriptor` projection.
  - Treats `package.json#name` as canonical plugin identity.
  - Rejects packages with missing or blank `package.json#name` by emitting an invalid descriptor and excluding them from activation.
  - Rejects duplicate canonical identities and route segment collisions from the activation manifest list.
  - Projects `source`, `layers`, compatibility fields, and validation warnings for desktop discovery.

- `apps/desktop/src/main/plugin-loader.ts`
  - Uses governed discovery results instead of deriving plugin identity from directory names.
  - Records desktop lifecycle state transitions: `discovered`, `activating`, `active`, and `failed`.
  - Exposes `getDesktopPluginDescriptors()` as a read-only desktop-side projection surface.
  - Records `desktop.webviewListener` capability registrations from `onWebviewCreated()`.
  - Records `desktop.sharedConfigEndpoint` capability registrations from `setSharedConfig()`, with the current env bootstrap marked as `compatibilityPath`.
  - Adds explicit `externalLocal` source support through `CRADLE_DESKTOP_EXTERNAL_PLUGIN_DIRS` and `CRADLE_EXTERNAL_PLUGINS_DIRS`; these roots are represented as trusted operator-configured local code and do not imply sandbox isolation.
  - Preserved the existing `requestBrowserTab(url?: string)` behavior and IPC payload.

## Preserved Existing Work

- `packages/plugin-sdk/src/desktop.ts`
  - Existing `requestBrowserTab(url?: string)` context API remains intact.

- `apps/desktop/src/main/plugin-loader.ts`
  - Existing `requestBrowserTab()` window selection and `browser-use:create-tab` IPC behavior remains intact.

## Validation Performed

- `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json`
  - Passed.

## Unresolved Issues

- No dedicated automated fixture test was added for missing `package.json#name`, duplicate identity, or route segment collision cases in this worker pass.
- The route segment helper is currently local to desktop discovery. A later integration pass should replace it with the shared normalizer used by server/web once that helper lands, so all layers derive route segments identically.
- `getDesktopPluginDescriptors()` is an in-process projection surface only; this worker did not wire it into a server API or renderer/devtool consumer.
