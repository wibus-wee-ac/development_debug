<!--
Input: Alma Playwright/Chromium BiDi evidence and Cradle test/browser-use audit.
Output: Spec for Playwright/BiDi runtime management.
Position: docs/specs/alma-inspired/playwright-bidi-runtime.md
-->

# Playwright And BiDi Runtime

## Goal

Cradle should treat Playwright or Chromium BiDi as a product runtime only if it needs automation beyond the in-app browser-use plugin.

## Alma Evidence

Alma depends on `playwright` and `chromium-bidi`, exposes `playwright.getStatus`, `install`, and install status events, and installs browsers in the background.

## Cradle Current State

Cradle uses `@playwright/test` for tests and browser-use for in-app browser control. It has no user-facing Playwright install/status/runtime manager.

## Target Ownership

A future browser automation owner would manage Playwright installation, browser binaries, test/runtime separation, and automation sessions. It must not be hidden inside test tooling.

## Target Behavior

- Users can see browser runtime status and install missing browsers.
- Automation sessions declare browser type, profile isolation, network policy, and artifact retention.
- Runtime errors distinguish missing browser binaries from navigation/action failures.

## API Sketch

- `GET /browser-runtime/status`
- `POST /browser-runtime/install`
- `POST /browser-runtime/sessions`
- `POST /browser-runtime/sessions/:id/actions`

## Data Model

Persist installed runtime metadata, session records, and artifact references. Browser binaries remain in platform-appropriate cache directories.

## Acceptance

- Missing browser dependencies produce an install action, not a stack trace.
- Test Playwright dependency and product runtime dependency are separable.
- A failed install leaves the previous runtime state intact.
