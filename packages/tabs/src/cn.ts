// Input: clsx, tailwind-merge
// Output: cn utility for merging Tailwind class names
// Position: Internal utility within @cradle/tabs; not exported

import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
