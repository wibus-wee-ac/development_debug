# profiles

Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

- `profiles.module.ts` — wires saved profile endpoints and lifecycle service.
- `profiles.controller.ts` — exposes `/profiles` CRUD endpoints with typed provider `config` objects at the HTTP boundary, including Available Model registry mapping updates.
- `profiles.service.ts` — coordinates saved profile semantics, preserves profile config fields, stores profile-owned models.dev mappings, blocks ordinary edits to external-source mirrored profiles, and handles session cleanup.
- `profiles.store.ts` — persists saved profiles and profile-owned cascade deletion.
