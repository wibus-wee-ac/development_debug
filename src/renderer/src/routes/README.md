<!-- Once this directory changes, update this README.md -->

# routes

TanStack Router file-based routes.
The router plugin auto-generates `../routeTree.gen.ts` from this directory.
Each file corresponds to a route segment; `__root.tsx` is the global root layout.

## Files

- **\_\_root.tsx**: Root route — theme side-effects plus shared `ToastProvider`, `TooltipProvider`, and `ShortcutProvider` around the main app shell
- **index.tsx**: `/` — main launcher route mounted inside `AppLayout`; accepts `workspaceId` search so sidebar clicks can preselect a workspace on the homepage
- **chat.$sessionId.tsx**: `/chat/$sessionId` — active chat session page; reattaches or refreshes the live ACP session binding on demand while the persisted SQLite thread remains stable
- **devtool.tsx**: `/devtool` — standalone IPC devtool page loaded by the dev-only second BrowserWindow
- **workspace.$workspaceId.tsx**: `/workspace/$workspaceId` — project detail page with WYSIWYG editing of README.md, AGENTS.md, and workspace settings
