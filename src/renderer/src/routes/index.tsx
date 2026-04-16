import { Button } from '@renderer/components/ui/button'
import { Card } from '@renderer/components/ui/card'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <div>
      <Button>Click me</Button>
    </div>
  )
}
