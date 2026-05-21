# Logging

Shared server logging infrastructure. Startup, plugin host, request, and fatal process diagnostics should go through this namespace so stdout and file logging stay consistent.

## Files

- **logger.ts**: pino-backed logger wrapper, optional file destination setup, child logger creation, and explicit flush support for fatal exits.
