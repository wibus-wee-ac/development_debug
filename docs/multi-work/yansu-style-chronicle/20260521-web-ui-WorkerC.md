# Worker C Handoff: Web Chronicle Usability Slice

## Scope

Assigned node: implement or prepare the Web Chronicle usability slice.

Write scope used:

- `apps/web/src/features/chronicle/use-chronicle.ts`
- `apps/web/src/features/chronicle/chronicle-settings.tsx`
- `apps/web/src/features/chronicle/README.md`
- `docs/multi-work/yansu-style-chronicle/20260521-web-ui-WorkerC.md`

No generated API files, Server files, DB files, or Rust files were edited.

## Implemented

- Expanded `use-chronicle.ts` into the Web compatibility boundary for Chronicle API data.
- Added stable local UI types for:
  - Chronicle config
  - Runtime status
  - Local model resources
  - Timeline entries
  - Memory entries
- Added compatibility normalizers for stale generated API types where generated responses are still `unknown`.
- Added hooks for:
  - `useChronicleModelResources()`
  - `useChronicleMemorySearch()`
  - `useRefreshChronicleQueries()`
- Updated `chronicle-settings.tsx` to expose:
  - Capture enablement
  - Provider/model selection
  - Usable runtime status
  - Local model resource categories
  - Timeline preview with OCR context
  - Memories list
  - Memory search input and filtered results
- Added `apps/web/src/features/chronicle/README.md` documenting ownership and the temporary API compatibility boundary.

## API Compatibility Notes

The current generated Web API still has `unknown` for `/chronicle/resources`, `/chronicle/timeline`, and `/chronicle/memories`. The Web slice does not edit generated files. Instead, `use-chronicle.ts` accepts both old and planned shapes:

- Timeline arrays: root array, `entries`, `timeline`, or `snapshots`.
- Memory arrays: root array, `entries`, `memories`, or `results`.
- Model resource arrays: root array, `resources`, `modelResources`, or `models`.

Default model resource categories are shown when Server still returns only daemon resource usage:

- `ocr`
- `audio-vad`
- `audio-asr`
- `speaker`
- `embedding`

OCR defaults to available through `macOS Vision`. The other categories default to optional until Server reports real Chronicle-owned resource state.

## Validation

Ran:

```bash
pnpm --filter @cradle/web exec tsc --noEmit
```

Result:

- Chronicle files no longer report TypeScript errors.
- The command still fails because of pre-existing unrelated errors in `src/features/chat/use-chat-session-binding.test.tsx`:
  - Tuple type `[]` has no element at index `1`.
  - Two `never` call signature errors.

No browser/manual UI validation was run in this worker node.

## Integration Risks

- If Server adds a real `/chronicle/memories/search` endpoint, `useChronicleMemorySearch()` should switch from client-side filtering over `/chronicle/memories` to the Server search endpoint.
- If DB-backed timeline stops serving frames via `/chronicle/frame/{displayId}/{segment}/{frame}`, `TimelineScrubber.frameUrl()` will need the new artifact URL field or route.
- Once API generation is refreshed, tighten `use-chronicle.ts` normalizers instead of spreading generated type casts into `chronicle-settings.tsx`.
