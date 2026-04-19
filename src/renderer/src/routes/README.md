<!-- Once this directory changes, update this README.md -->

# routes

TanStack Router file-based routes. The router plugin auto-generates `../routeTree.gen.ts` from this directory.
Each file corresponds to a route segment; `__root.tsx` is the global root layout.

## Files

- **__root.tsx**: Root route — theme side-effects, `ShortcutProvider`, and the TanStack Router devtools overlay
- **index.tsx**: `/` — main workspace view mounted inside `AppLayout`
- **chat.$sessionId.tsx**: `/chat/$sessionId` — active chat session page
- **devtool.tsx**: `/devtool` — standalone IPC devtool page loaded by the dev-only second BrowserWindow
