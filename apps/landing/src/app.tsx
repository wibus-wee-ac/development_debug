import { CanvasBg } from './components/canvas-bg'
import { Footer } from './components/footer'
import { Hero } from './components/hero'
import { Nav } from './components/nav'

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
