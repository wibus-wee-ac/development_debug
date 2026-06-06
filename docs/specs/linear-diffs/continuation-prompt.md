# Linear Diffs Continuation Prompt

Use this prompt to restart future work on the Cradle Diff Review feature without relying on prior chat history.

```text
You are working in /Users/wibus/dev/Cradle.

Goal:
Continue the Linear Diffs inspired Cradle Diff Review feature design or implementation. Treat the current repository state as authoritative and read the relevant files before proposing or editing.

Primary specs:
- docs/specs/linear-diffs/source-research.md
- docs/specs/linear-diffs/cradle-diff-review-spec.md
- docs/specs/linear-diffs/feature-coverage-matrix.md

Important current-state files:
- apps/web/src/features/browser/workspace-diff-viewer.tsx
- apps/web/src/features/git/changes-panel.tsx
- apps/web/src/features/chat/blocks/edit-file-block.tsx
- apps/web/src/features/chat/blocks/tool-call-block.tsx
- apps/server/src/modules/git/service.ts
- apps/server/specs/capabilities/git.md

External facts:
- Linear Docs page: https://linear.app/docs/diffs
- Linear changelog: https://linear.app/changelog/2026-05-27-linear-diffs
- Linear product page: https://linear.app/diffs

Design constraints:
- Cradle should introduce an independent diff-review/code-review owner. Do not expand git, browser-panel, chat, or issue into the review lifecycle owner.
- git owns local repository facts and patch materialization only.
- browser-panel owns hosting only.
- chat owns transcript and tool rendering only.
- issue/workspace/session/agent facts may be read as context but review lifecycle rows belong to diff-review.
- Preserve namespace ownership. Cradle may read other namespaces but must not write lifecycle data into the wrong owner.
- Use Drizzle for database design.
- Use existing @pierre/diffs APIs for parser/rendering unless current evidence proves they cannot support a requirement.
- Do not create new low-level diff projections without first checking existing library API and current code.
- All code, comments, identifiers, and code blocks must be English. Discussion outside code can be Simplified Chinese.

Expected next action:
1. Re-read the specs and current code.
2. Decide whether the task is SPEC refinement, ExecPlan creation, or implementation.
3. If implementing, start with the smallest architecture-correct slice:
   - diff-review server module with local-working-tree source;
   - immutable revision materialization from git diff;
   - review-owned web container that reuses @pierre/diffs renderer;
   - Changes panel opens a review, not a browser-owned raw workspace diff.
4. Verify ownership boundaries and avoid touching unrelated dirty worktree changes.
```
