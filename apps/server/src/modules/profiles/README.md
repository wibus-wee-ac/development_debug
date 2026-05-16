<!--
Output: Inventory for saved runtime profile lifecycle.
Input: User-owned provider configuration profiles and profile deletion semantics.
Position: apps/server/src/modules/profiles module guide.
-->

# profiles

Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

- `profiles.module.ts` — wires saved profile endpoints and lifecycle service.
- `profiles.controller.ts` — exposes `/profiles` CRUD endpoints with typed provider `config` objects at the HTTP boundary.
- `profiles.service.ts` — coordinates saved profile semantics, preserves profile config fields, and handles session cleanup.
- `profiles.store.ts` — persists saved profiles and profile-owned cascade deletion.
