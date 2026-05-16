// Input: system clock
// Output: shared Unix timestamp helpers for server modules
// Position: app-level helper used by module services that persist timestamps

export function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
