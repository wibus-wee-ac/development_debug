# provider-targets

Provider-target resolver and Cradle-owned runtime preference API.

- `index.ts`: HTTP routes for reading and updating provider-target model settings, model visibility, custom models, and models.dev mappings.
- `model.ts`: Elysia request and response schemas for provider-target preference routes.
- `service.ts`: Resolves a runtime provider target into normalized config, credential, and ownership-aware metadata for manual profiles and external provider records.

Manual profiles and external runtime targets both implement the provider-target contract. External source records remain source-owned; model visibility, custom models, and registry mappings are Cradle-owned runtime preferences and are written to the runtime target namespace.
