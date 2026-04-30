<!-- Once this directory changes, update this README.md -->

# Main/Agent Runtime/Providers

Concrete provider implementations live here.
Each provider translates one runtime family into the shared Agent Runtime contracts.
Keep provider-specific protocol parsing out of higher-level services.

## Files

- **openai-compatible-provider.ts**: OpenAICompatibleProvider validates Base URL/API key profile config and exposes configured model metadata.
