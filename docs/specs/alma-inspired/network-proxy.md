<!--
Input: Alma network settings evidence and Cradle provider/network gap.
Output: Spec for network proxy and request policy.
Position: docs/specs/alma-inspired/network-proxy.md
-->

# Network Proxy And Request Policy

## Goal

Cradle should expose a centralized network policy for providers, connectors, web fetch, plugin downloads, and desktop update checks.

## Alma Evidence

Alma settings include HTTP/HTTPS/SOCKS5 proxy, authentication, proxy test, prefer IPv4, timeout, retry, and custom user agent.

## Cradle Current State

Cradle provider profiles can configure provider-specific base URLs and credentials. No global proxy, retry, timeout, or user-agent settings surface was found.

## Target Ownership

A future `network` preference owner stores global request policy. Individual modules read this policy but do not write it. Secrets stores proxy credentials if needed.

## Target Behavior

- Users can configure proxy URL, auth, timeout, retry, IPv4 preference, and user agent.
- Modules can opt into global policy or declare a reason for bypass.
- A test action verifies connectivity through the configured policy.
- Sensitive proxy credentials are masked.

## API Sketch

- `GET /network/policy`
- `PUT /network/policy`
- `POST /network/policy/test`

## Data Model

Persist non-secret policy in preferences. Store proxy credentials in `secrets` and reference them by id.

## Acceptance

- Provider health checks use network policy unless explicitly exempt.
- Proxy test reports DNS, connect, TLS, auth, and HTTP failures separately.
- Clearing proxy settings removes related secret references if unused.
