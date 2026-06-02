import { Nav } from './components/nav'
import { Hero } from './components/hero'
import { ProblemSection } from './components/problem'
import { Features } from './components/features'
import { HowItWorksSection } from './components/how-it-works'
import { ComparisonSection } from './components/comparison'
import { CTASection } from './components/cta-section'
import { Footer } from './components/footer'
import { CanvasBg } from './components/canvas-bg'

export function App() {
  return (
    <>
      <CanvasBg />
      <Nav />
      <main>
        <Hero />
        <ProblemSection />
        <Features />
        <HowItWorksSection />
        <ComparisonSection />
        <CTASection />
      </main>
      <Footer />
    </>
  )
}
