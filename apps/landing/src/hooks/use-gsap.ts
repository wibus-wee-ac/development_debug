import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Observer } from 'gsap/Observer'
import { useGSAP } from '@gsap/react'

// Register all plugins once
gsap.registerPlugin(ScrollTrigger, Observer, useGSAP)

// Configure GSAP defaults
gsap.defaults({
  ease: 'power3.out',
})

// Match media helper for responsive animations
export const mm = gsap.matchMedia()

export { gsap, ScrollTrigger, Observer, useGSAP }
