#!/usr/bin/env bash
# Output: Language-agnostic scan for Output/Input/Position ownership header comments.
# Input: Repository text files under the current working directory.
# Position: Tooling helper for cleanup scans that cannot be expressed across all languages with ast-grep.

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
RULE_FILE="$ROOT_DIR/ast-grep/text-rules/ownership-header-comment.regex"

cd "$ROOT_DIR"

rg --line-number --no-heading --color never \
  --regexp "$(cat "$RULE_FILE")" \
  --glob '!apps/web/src/api-gen/**' \
  --glob '!apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**' \
  --glob '!**/node_modules/**' \
  --glob '!**/dist/**' \
  --glob '!apps/desktop/release/**' \
  --glob '!apps/desktop/release*/**' \
  --glob '!**/.git/**' \
  --glob '!pnpm-lock.yaml' \
  --glob '!*.tsbuildinfo' \
  "$@"
