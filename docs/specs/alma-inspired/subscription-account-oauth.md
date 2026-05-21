<!--
Input: Alma Copilot and Claude Subscription preload evidence.
Output: Spec for subscription account OAuth flows.
Position: docs/specs/alma-inspired/subscription-account-oauth.md
-->

# Subscription Account OAuth

## Goal

Cradle should support account-based AI subscriptions that cannot be represented as simple API key profiles, starting with GitHub Copilot and Claude Subscription only if the team accepts their product and policy risk.

## Alma Evidence

Alma preload exposes `copilot` methods for device-code auth, token save, token lookup, multi-account listing, user fetch, and logout. It exposes `claudeSubscription` methods for auth URL, authorization start/complete/cancel, token refresh, profile, quota, models, and logout.

## Cradle Current State

Cradle has `profiles`, `providers`, and encrypted `secrets`, but no first-class subscription account lifecycle, device-code flow, quota fetch, or account switcher.

## Target Ownership

`profiles` owns account-backed provider profile metadata. `secrets` owns refresh/access token material. Provider-specific OAuth adapters own protocol details.

## Target Behavior

- Users can add, refresh, inspect, and remove subscription accounts.
- Token material never reaches Web except masked status.
- Quota/model status is visible in provider settings.
- Account profiles can be selected by chat runtime like other profiles.

## API Sketch

- `POST /provider-accounts/:kind/start-auth`
- `POST /provider-accounts/:kind/complete-auth`
- `POST /provider-accounts/:id/refresh`
- `GET /provider-accounts`
- `DELETE /provider-accounts/:id`

## Acceptance

- Logging out removes secret material and disables dependent profiles.
- Expired tokens surface as actionable reauth status.
- Multiple accounts of the same kind can coexist.
