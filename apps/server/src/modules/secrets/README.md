<!--
Output: Inventory for generic server-owned secret storage.
Input: Secret create/list/delete requests and encrypted persistence.
Position: apps/server/src/modules/secrets module guide.
-->

# secrets

- `secrets.module.ts` — wires secret lifecycle providers and controller.
- `secrets.controller.ts` — exposes `/secrets` CRUD endpoints.
- `secrets.service.ts` — validates configuration and maps secret errors.
- `secrets.store.ts` — persists encrypted secrets and masked metadata.
- `secret-cipher.ts` — AES-256-GCM wrapper around `CRADLE_CREDENTIAL_SECRET`.
- `types.ts` — shared secret API shapes.