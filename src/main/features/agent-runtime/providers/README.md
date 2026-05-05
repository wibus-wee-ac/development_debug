<!-- Once this directory changes, update this README.md -->

# Main/Agent Runtime/Providers

Concrete provider implementations live here.
Each provider translates one runtime family into the shared Agent Runtime contracts.
Keep provider-specific protocol parsing out of higher-level services.

## Files

- **openai-compatible-provider.ts**: OpenAICompatibleProvider validates Base URL/API key profile config, streams chat completions, and normalizes user-triggered aborts so cancelled turns do not finalize as completed.
