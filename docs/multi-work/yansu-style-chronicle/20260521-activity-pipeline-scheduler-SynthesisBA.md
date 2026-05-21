# Activity Pipeline Scheduler Synthesis BA

## Scope

Implemented the Chronicle-owned automatic Activity Pipeline scheduler slice.

## Changes

- Added Server config and status fields:
  - `activityPipelineEnabled`
  - `activityPipelineIntervalMs`
  - `activityPipelineBatchSize`
  - `activityPipelineRunning`
- Added scheduler lifecycle behavior:
  - startup calls `restartActivityPipelineScheduler()`
  - config updates restart or stop the scheduler
  - server shutdown stops the scheduler
- Added manual tick route:
  - `POST /chronicle/activity-pipeline/tick`
- Added tick behavior:
  - oldest eligible `collecting` or `error` segment advances through triage
  - oldest eligible `triaged` segment advances through summarization
  - oldest eligible `summarized` segment advances through crystallization
  - disabled Chronicle or disabled activity pipeline returns zero work
- Added Web controls:
  - Automatic Activity Pipeline switch
  - status text for scheduler readiness/running state
  - manual Tick action in the Pipeline Runs panel
- Extended Chronicle integration coverage for automatic progression and disabled no-op behavior.

## Validation

Target validation commands for this slice:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
git diff --check
```

## Remaining Scope

This does not claim full Yansu parity. AXObserver notification lifecycle, system audio capture, real VAD/ASR/speaker runtimes, ONNX text embeddings, semantic merge thresholds, automatic dream scheduling, and solve-layer integration remain open.
