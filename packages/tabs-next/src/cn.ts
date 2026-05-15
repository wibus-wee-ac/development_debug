// Input: clsx values and tailwind-merge
// Output: cn utility for stable static class composition
// Position: Internal styling helper for tabs-next components

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
