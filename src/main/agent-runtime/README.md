<!-- Once this directory changes, update this README.md -->

# Main/Agent Runtime

Unified main-process runtime layer for Agent Profiles and provider implementations.
This directory owns provider lookup, credential metadata, and provider-specific adapters.
Services call this layer instead of talking directly to ACP, CLI, or API providers.

## Files

- **credential-vault.ts**: CredentialVault stores encrypted secrets and returns masked metadata only.
- **provider-catalog.ts**: ProviderCatalog registers and resolves providers by ProviderKind.
- **types.ts**: Shared Agent Runtime provider contracts and data types.
- **providers/**: Concrete provider implementations for OpenAI-compatible APIs.
- **__tests__/**: Unit tests for provider contracts, credentials, and concrete providers.
