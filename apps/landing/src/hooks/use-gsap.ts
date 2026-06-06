import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Observer } from 'gsap/Observer'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// Register all plugins once
gsap.registerPlugin(ScrollTrigger, Observer, useGSAP)

// Configure GSAP defaults
gsap.defaults({
  ease: 'power3.out',
})

// Match media helper for responsive animations
export const mm = gsap.matchMedia()

export { gsap, Observer, ScrollTrigger, useGSAP }
