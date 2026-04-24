<!-- Once this directory changes, update this README.md -->

# Main/Agent Runtime

Unified main-process runtime layer for Agent Profiles and provider implementations.
This directory owns provider lookup, credential metadata, JSONL RPC, and provider-specific adapters.
Services call this layer instead of talking directly to ACP, CLI, Codex, or API providers.

## Files

- **credential-vault.ts**: CredentialVault stores encrypted secrets and returns masked metadata only.
- **json-line-rpc-connection.ts**: JsonLineRpcConnection dispatches JSONL requests, responses, and notifications for local app-server providers.
- **provider-catalog.ts**: ProviderCatalog registers and resolves providers by ProviderKind.
- **types.ts**: Shared Agent Runtime provider contracts and data types.
- **providers/**: Concrete provider implementations for Codex App Server and OpenAI-compatible APIs.
- **__tests__/**: Unit tests for provider contracts, credentials, JSONL RPC, and concrete providers.
