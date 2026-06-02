#!/usr/bin/env bash
# Output: Verifies the language-agnostic Output/Input/Position header text rule.
# Input: Persisted regex from ast-grep/text-rules plus temporary mixed-prefix fixture lines.
# Position: Tooling smoke test for ownership-header cleanup scans.

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
RULE_FILE="$ROOT_DIR/ast-grep/text-rules/ownership-header-comment.regex"
FIXTURE_FILE="$(mktemp)"

cleanup() {
  rm -f "$FIXTURE_FILE"
}
trap cleanup EXIT

cat >"$FIXTURE_FILE" <<'FIXTURE'
// Output: Read-only detail panel for external provider records in Provider settings.
// Input: Connected provider metadata plus provider-backed model fetch.
// Position: Shows user-facing connected app details while keeping source-owned fields read-only.
### Output: Markdown heading prefix should still match.
<!-- Input: HTML comment prefix should still match.
%%% Position: Arbitrary symbol prefix should still match.
Output: Bare ownership header should still match.
const message = "Output: this string is not a header"
Normal prose Output: this is not a header.
FIXTURE

match_count="$(
  rg --line-number --no-heading --color never \
    --regexp "$(cat "$RULE_FILE")" \
    "$FIXTURE_FILE" \
    | wc -l \
    | tr -d ' '
)"

if [[ "$match_count" != "7" ]]; then
  echo "expected 7 ownership header matches, got $match_count" >&2
  rg --line-number --no-heading --color never \
    --regexp "$(cat "$RULE_FILE")" \
    "$FIXTURE_FILE" >&2 || true
  exit 1
fi
