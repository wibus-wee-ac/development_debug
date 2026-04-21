<!-- Once this directory changes, update this README.md -->

# Features/ACP Management

ACP agent management feature: lifecycle, registry, installation status, and settings UI.
Promoted from `features/settings/acp-settings.tsx` to its own domain as it constitutes a full sub-system.
The settings feature references this via import.

## Files

- **acp-settings.tsx**: AcpSettings component — full ACP management UI (add, configure, detect agents)
- **index.ts**: Barrel export
