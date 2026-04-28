// Input: QueryClient, App component, IpcDevtoolPage
// Output: Renderer entry point — hash check for DevTool window, otherwise main App
// Position: Entry point for the renderer process

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReactDOM from 'react-dom/client'

import { App } from './app'
import { IpcDevtoolPage } from './features/devtool'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30s — IPC results stay fresh for 30s
      retry: 1,
    },
  },
})

const rootElement = document.getElementById('app')!
const isDevtool = window.location.hash === '#/devtool'

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <QueryClientProvider client={queryClient}>
      {isDevtool ? <IpcDevtoolPage /> : <App />}
    </QueryClientProvider>,
  )
}
