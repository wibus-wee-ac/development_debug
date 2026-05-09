<!--
Output: ACP module inventory.
Input: AcpModule, controller, service, store, registry, installer.
Position: apps/server/src/modules/acp
-->

# ACP Module

HTTP-first ACP management capability for registry browsing, installation lifecycle resources, installed-agent inventory, and audit queries.

## Files

- **acp.module.ts**: Tsuki module registration.
- **acp.controller.ts**: HTTP endpoints for ACP management, including installation resource routes.
- **acp.service.ts**: capability semantics and orchestration.
- **acp.store.ts**: DB-backed ACP install/audit persistence.
- **acp.registry.ts**: remote registry fetch and distribution helpers.
- **acp.installer.ts**: binary/package install helpers for server runtime.
