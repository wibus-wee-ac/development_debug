<!--
Input: Alma Activity Recorder evidence and Cradle Chronicle audit.
Output: Spec for Activity Recorder v2.
Position: docs/specs/alma-inspired/activity-recorder.md
-->

# Activity Recorder

## Goal

Cradle Chronicle should evolve from screen OCR memory into a broader activity recorder only if ownership and privacy boundaries remain explicit.

## Alma Evidence

Alma Activity Recorder captures screenshots, OCR text, input events, browser URL/tab titles, per-app focus, session analysis, reports, digests, semantic search, keyword search, suggestions, and tray start/stop.

## Cradle Current State

Cradle Chronicle captures screen frames, OCR, artifacts, memory summaries, timeline, resources, and settings. It lacks input-event capture, browser URL/tab correlation, app focus history, tray digest/report actions, and suggestions.

## Target Ownership

`chronicle` owns passive activity records, privacy filtering, and memory generation. Desktop owns native capture adapters. Browser plugins may provide browser tab metadata through explicit integration.

## Target Behavior

- Users can start, pause, resume, and stop recording.
- Recording captures screen/OCR plus optional app focus and browser metadata.
- Sensitive windows and apps can be excluded.
- Reports and digests are generated from Chronicle records with clear provenance.

## API Sketch

- `GET /chronicle/status`
- `POST /chronicle/recording/start`
- `POST /chronicle/recording/stop`
- `GET /chronicle/activity/sessions`
- `POST /chronicle/activity/sessions/:id/analyze`
- `GET /chronicle/activity/digest`

## Data Model

Extend Chronicle tables with app focus events, browser metadata events, capture source ids, privacy filter decisions, and analysis records.

## Acceptance

- Recording can be paused from tray without losing existing artifacts.
- Excluded apps never write OCR text or screenshots.
- A digest can cite source snapshots and event ranges.
