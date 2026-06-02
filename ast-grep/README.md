# Output: Documents persistent ast-grep architecture hygiene scans.
# Input: Developers running legacy cleanup scans and optional facade audits from the repository root.
# Position: Owned by repository tooling; cleanup rules live in `ast-grep/rules`, optional audits in `ast-grep/audit-rules`.

# ast-grep Architecture Scans

Run the default legacy cleanup scan from the repository root:

```sh
ast-grep scan apps packages plugins \
  --globs '!apps/web/src/api-gen/**' \
  --globs '!apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**' \
  --globs '!**/node_modules/**' \
  --globs '!**/dist/**' \
  --globs '!apps/desktop/release/**' \
  --report-style short
```

Current baseline results and review notes are recorded in `wrapper-compatibility-report.md`.

The default rules are intentionally high-signal cleanup queues, not automatic deletion rules:

- `compatibility-comment-marker`: flags comments that explicitly mention legacy/deprecated compatibility debt.

Run optional facade audits when reviewing ownership boundaries. These rules include many legitimate feature-owned wrappers, so they are not loaded by `sgconfig.yml`:

```sh
ast-grep scan -c ast-grep/audit-sgconfig.yml apps packages plugins \
  --globs '!apps/web/src/api-gen/**' \
  --globs '!apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**' \
  --globs '!**/node_modules/**' \
  --globs '!**/dist/**' \
  --globs '!apps/desktop/release/**' \
  --report-style short
```

Audit rule intent:

- `generated-api-call-wrapper`: feature-owned API facades over generated HTTP SDK calls.
- `generated-query-wrapper`: feature-owned `use*` hooks over `useQuery(...)`.
- `generated-query-wrapper-tsx`: TSX-local `use*` hooks over `useQuery(...)`.
- `lazy-component-loader-wrapper`: route/tab loader facades.
- `preload-only-wrapper`: route/tab preload facades.
- `service-pass-through-wrapper`: broad low-semantics pass-through functions.

For a broader lexical sweep, run this separately because it includes legitimate strings such as `openai-compatible`:

```sh
ast-grep scan apps packages plugins \
  --inline-rules $'id: compatibility-string-marker\nlanguage: TypeScript\nrule:\n  any:\n    - kind: string_fragment\n    - kind: template_string\n  regex: (?i)(legacy|backward|backwards|old\\s+(helper|path|api|surface|entry|wrapper))\nseverity: hint\nmessage: Compatibility marker in string.' \
  --globs '!apps/web/src/api-gen/**' \
  --globs '!apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**' \
  --globs '!**/node_modules/**' \
  --globs '!**/dist/**' \
  --globs '!apps/desktop/release/**' \
  --report-style short
```
