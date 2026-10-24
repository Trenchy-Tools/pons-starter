/**
 * Request-field parsing shared by the server routes (local mode) and the browser engine (demo mode): the same JSON in,
 * the same bounds and defaults. No node imports. (The launch form itself is lib/core/launch.ts normalizeForm.)
 */

/** A number from a form field, or the default. */
export const num = (v: unknown, d: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [])

export const isAddress = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)
