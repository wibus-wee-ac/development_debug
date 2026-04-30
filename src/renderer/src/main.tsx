// Input: QueryClient, App component, IpcDevtoolPage, TearOffApp
// Output: Renderer entry point — hash-based routing to DevTool, TearOff, or main App
// Position: Entry point for the renderer process

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReactDOM from 'react-dom/client'

import { App } from './app'
import { IpcDevtoolPage } from './features/devtool'
import { TearOffApp } from './tear-off-app'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30s — IPC results stay fresh for 30s
      retry: 1,
    },
  },
})

const rootElement = document.getElementById('app')!
const hash = window.location.hash.slice(1)
const isDevtool = hash === '/devtool'
const tearOffMatch = hash.match(/^\/chat\/([^?]+)\?tearoff=true$/)

function RootApp() {
  if (isDevtool) return <IpcDevtoolPage />
  if (tearOffMatch) return <TearOffApp sessionId={tearOffMatch[1]} />
  return <App />
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <QueryClientProvider client={queryClient}>
      <RootApp />
    </QueryClientProvider>,
  )
}
