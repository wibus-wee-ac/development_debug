/**
 * @deprecated This hook is no longer needed.
 * Block animation meta is now computed internally by StreamdownRender
 * using the persistent births ref pattern.
 */
// eslint-disable-next-line ts/no-explicit-any
export function useBlockAnimationMeta(): Map<string, any> {
  return new Map()
}
