# Provider Custom Icon Picker

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintained in accordance with `docs/exec-plans/` conventions per PLANS.md (user-level skill reference).

## Purpose / Big Picture

Users can select a custom icon for each provider profile from the Lobe Icons library (301 icons). After this change, clicking the provider icon in the profile detail header opens a popover/picker with search and grid selection. The chosen icon persists in the database and displays across all surfaces that show the provider.

Observable outcome: Open a provider profile → click the icon → search for "openai" → select it → icon updates immediately and persists across page reloads.

## Progress

- [x] (2025-05-17 12:30Z) Exploration complete — context gathered, plan written
- [x] (2025-05-17 12:35Z) DB schema migration: added `iconSlug` column to `agentProfiles` (0020_dusty_hobgoblin.sql)
- [x] (2025-05-17 12:36Z) Server: expose `iconSlug` in profile CRUD responses + PATCH /:id/icon endpoint
- [x] (2025-05-17 12:38Z) Icon Picker UI component created (apps/web/src/components/ui/icon-picker.tsx)
- [x] (2025-05-17 12:40Z) Integration: wired picker into profile header + persist selection via PATCH
- [x] (2025-05-17 12:41Z) TypeScript ALL PASS, ESLint 0 errors

## Surprises & Discoveries

(none yet)

## Decision Log

- Decision: Store icon as `iconSlug` (the `docsUrl` field from lobe-icons-toc, e.g. "openai") rather than full path or URL.
  Rationale: Slug is compact, stable, and maps directly to `loadLobeIconSvg(slug)`. No URL rot risk.
  Date: 2025-05-17

- Decision: Place picker trigger on the existing icon in `ProfileDetailHeader`, not in settings section.
  Rationale: Direct manipulation — click the thing you want to change. More discoverable and intuitive.
  Date: 2025-05-17

- Decision: Use Popover (not modal) for the picker.
  Rationale: Lightweight, contextual, doesn't disrupt flow. Consistent with other inline-edit patterns.
  Date: 2025-05-17

## Outcomes & Retrospective

(pending completion)

## Context and Orientation

**Files involved:**

- `packages/db/src/schema/identity.ts` — `agentProfiles` table definition (Drizzle). Add `iconSlug` text column, nullable.
- `apps/server/src/modules/providers/index.ts` — Provider CRUD routes. Ensure `iconSlug` flows through PUT/GET responses.
- `apps/web/src/features/agent-management/profile-detail-panel.tsx` — Main profile editing panel. Header shows icon from `providerVisuals()`.
- `apps/web/src/lib/lobe-icons.ts` — Existing utility with `searchIcons()`, `loadLobeIconSvg()`, `lobeIconsToc`.
- New: `apps/web/src/components/ui/icon-picker.tsx` — Reusable icon picker popover component.

**Key concepts:**

- `providerVisuals(presetId)` returns `{ Icon, color }` from a static mapping `PROVIDER_ICONS`. This is the fallback when no custom icon is set.
- `lobeIconsToc` is an array of 301 entries with `{ id, docsUrl, title, fullTitle, color, group }`. The `docsUrl` field is the slug used to load SVGs.
- `loadLobeIconSvg(slug)` returns raw SVG string via Vite glob import.

## Plan of Work

### Milestone 1: DB + Server (schema + API)

Add nullable `iconSlug` text column to `agentProfiles`. Run drizzle-kit to generate migration. Ensure the server profile CRUD endpoints accept and return `iconSlug`.

### Milestone 2: Icon Picker Component

Create `apps/web/src/components/ui/icon-picker.tsx`:
- Popover trigger (renders current icon or default)
- Search input at top
- Grid of icons (virtualized if needed, but 301 is small enough)
- Each icon rendered as inline SVG loaded via `loadLobeIconSvg`
- Click selects and closes popover
- "Remove custom icon" option to revert to default

### Milestone 3: Integration

- In `ProfileDetailHeader`, make the icon clickable → opens IconPicker
- On selection: update profile via PUT with `iconSlug`
- Display: when `profile.iconSlug` is set, render it instead of `providerVisuals()` icon

## Concrete Steps

1. Edit `packages/db/src/schema/identity.ts`: add `iconSlug: text('icon_slug')` to agentProfiles
2. Run `pnpm --filter @cradle/db exec drizzle-kit generate` → produces migration SQL
3. Edit server provider routes to include `iconSlug` in schema/response
4. Create `apps/web/src/components/ui/icon-picker.tsx`
5. Edit `profile-detail-panel.tsx` to integrate IconPicker in header
6. Verify with `pnpm exec tsc --noEmit` on both web and server

## Validation and Acceptance

- TypeScript compiles cleanly for both `apps/web` and `apps/server`
- ESLint passes with 0 errors on modified files
- Migration file is generated
- Icon picker renders, search filters icons, selection persists

## Idempotence and Recovery

- Column addition is idempotent (nullable, no default needed)
- Migration can be re-run safely (drizzle-kit handles this)
- UI changes are additive — clicking icon opens picker; not clicking keeps existing behavior

## Interfaces and Dependencies

- `@lobehub/icons-static-svg` (already installed in apps/web)
- `~/lib/lobe-icons` (existing utility)
- Drizzle ORM for schema
- Popover from Radix UI (already in project as `@radix-ui/react-popover`)

## Artifacts and Notes

(will be populated during implementation)
