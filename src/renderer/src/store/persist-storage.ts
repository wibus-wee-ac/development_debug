// Input: zustand persist middleware plus browser localStorage availability
// Output: Safe JSON storage for persisted renderer stores with an in-memory fallback outside the browser
// Position: Renderer state persistence infrastructure used by Zustand stores

import { createJSONStorage } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'

const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}

export const persistStorage = createJSONStorage(() => {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      return globalThis.localStorage
    }
  }
  catch {
    // Ignore and fall back to in-memory storage for tests / restricted environments.
  }

  return memoryStorage
})