# Chronicle Knowledge Crystallization Fix AY

## Fixes Applied

- Added normalized `chronicle_knowledge_sources` instead of relying only on JSON source arrays.
- Added `chronicle_dream_candidates` so dream dry-run candidates are inspectable outside `resultJson`.
- Promoted knowledge `stableKey` to a first-class indexed Drizzle column.
- Regenerated the unsafe `stable_key` migration after detecting `ADD stable_key text NOT NULL` without a default. The final generated migration uses `DEFAULT '' NOT NULL`.
- Fixed Web JSX lint formatting for confidence badges.
- Ensured dream merge apply path increments source card version when marking cards as merged.

## Validation

- Server typecheck passed.
- Chronicle server test passed.
- Focused Chronicle Web ESLint passed.
