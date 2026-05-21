# CC Switch Plugin

This plugin registers a Cradle external provider source named `cc-switch`. It reads CC Switch provider data from the local CC Switch SQLite database and local settings JSON, then returns a fixed snapshot shape for the Cradle host to project into read-only provider profiles.

The plugin never writes to `~/.cc-switch`, never owns Cradle Provider UI, and never writes `agent_profiles` directly. The Cradle host owns projection, credential encryption, read-only guards, refresh routes, and the fixed Provider settings UI.

CC Switch is treated as a connection source. Snapshot records project base URLs and API keys into Cradle, while available model lists, custom models, visibility, models.dev mappings, and cost metadata stay owned by Cradle provider/profile modules.

## Files

- `package.json`: Declares the Cradle plugin manifest and build scripts.
- `vite.config.ts`: Builds the server plugin entry for packaged desktop use.
- `tsconfig.json`: TypeScript configuration for the plugin source.
- `src/server.ts`: Activates the plugin and registers the external provider source.
- `src/cc-switch-source.ts`: Reads CC Switch SQLite/JSON data and maps supported providers to Cradle snapshot records without projecting CC Switch model lists into Cradle profile config.
- `src/cc-switch-source.test.ts`: Uses a temporary CC Switch-like database with fake secrets to verify mapping, current provider precedence, and redaction boundaries.

## Configuration

By default the plugin reads:

- `~/.cc-switch/cc-switch.db`
- `~/.cc-switch/settings.json`

The paths can be overridden with shared config keys or environment variables:

- `CC_SWITCH_APP_CONFIG_DIR` or `CRADLE_CC_SWITCH_APP_CONFIG_DIR`
- `CC_SWITCH_DB_PATH` or `CRADLE_CC_SWITCH_DB_PATH`
- `CC_SWITCH_SETTINGS_PATH` or `CRADLE_CC_SWITCH_SETTINGS_PATH`

## Supported Projection

The first version projects `claude`, `codex`, and OpenAI-compatible `gemini` providers. Other CC Switch app families are counted and reported as warnings, but they are not projected as runnable Cradle provider profiles yet.
