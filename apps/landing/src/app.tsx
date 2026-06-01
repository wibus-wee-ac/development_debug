import { Nav } from './components/nav'
import { Hero } from './components/hero'
import { Features } from './components/features'
import { Footer } from './components/footer'

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Features />
      </main>
      <Footer />
    </>
  )
}
