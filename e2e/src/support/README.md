<!-- Once this directory changes, update this README.md -->

# E2E/Support

Shared Cucumber support code launches the packaged Electron app, isolates test state, and wires global hooks.
These files define the test world, setup/teardown lifecycle, and any auxiliary mock servers used across features.
Update this directory when end-to-end infrastructure or shared fixtures change.

## Files

- **hooks.ts**: Global Cucumber hooks for launching the app, capturing failure screenshots, and closing sessions
- **mock-llm-server.ts**: Local OpenAI-compatible mock server used by chat end-to-end scenarios
- **world.ts**: Custom Cucumber world that launches Electron with isolated `userData` and `HOME` sandboxes
