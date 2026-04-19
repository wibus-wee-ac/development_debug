// Input: IpcDevtoolPage feature component, TanStack Router file-route factory
// Output: /devtool route rendering the standalone IPC devtool page
// Position: Top-level route loaded in the dev-only second BrowserWindow

import { createFileRoute } from '@tanstack/react-router'

import { IpcDevtoolPage } from '@renderer/features/ipc-devtool'

export const Route = createFileRoute('/devtool')({
  component: DevtoolRoute,
})

function DevtoolRoute() {
  return <IpcDevtoolPage />
}
