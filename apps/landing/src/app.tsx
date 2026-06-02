import { Nav } from './components/nav'
import { Hero } from './components/hero'
import { Footer } from './components/footer'
import { CanvasBg } from './components/canvas-bg'

export function App() {
  return (
    <>
      <CanvasBg />
      <Nav />
      <main>
        <Hero />
      </main>
      <Footer />
    </>
  )
}
