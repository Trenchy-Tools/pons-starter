/**
 * Settings: `_app/pons-starter/settings.json` in the wallet folder (written by the Settings sheet) over `.env` defaults.
 *   apiKey      TRENCHY_API_KEY
 *   apiUrl      TRENCHY_API_URL      default https://api.trenchytools.lol
 *   slippage    (percent)            default 10
 *   sniperGapMs                      default 400 (gap between sniper buys after the create confirms)
 *   holderWindowS / holderDelayS     default 120 / 5 (holder buys spread over the window, after the delay)
 *   mainWallet                       the ★ wallet (0x address): pays for everything, receives gathers, default creator
 */
import { SETTINGS_FILE, readJson, writeJson } from "./paths"

export const DEFAULT_API_URL = "https://api.trenchytools.lol"
const DEFAULTS = { slippage: 10, sniperGapMs: 400, holderWindowS: 120, holderDelayS: 5 }

export type Settings = { apiKey?: string; apiUrl?: string; slippage?: number; sniperGapMs?: number; holderWindowS?: number; holderDelayS?: number; mainWallet?: string }
const NUMS = ["slippage", "sniperGapMs", "holderWindowS", "holderDelayS"] as const

export function readSettings(): Settings {
  const raw = readJson<Settings>(SETTINGS_FILE, {})
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined)
  const out: Settings = { apiKey: str(raw.apiKey), apiUrl: str(raw.apiUrl), mainWallet: str(raw.mainWallet) }
  for (const k of NUMS) out[k] = num(raw[k])
  return out
}

/** A field left undefined keeps its value; null or "" clears it (back to the .env default). */
export function updateSettings(patch: { [K in keyof Settings]?: Settings[K] | null }): Settings {
  const next: Settings = { ...readSettings() }
  for (const k of ["apiKey", "apiUrl", "mainWallet"] as const) {
    if (patch[k] === undefined) continue
    const v = typeof patch[k] === "string" ? patch[k]!.trim() : ""
    if (v) next[k] = v
    else delete next[k]
  }
  for (const k of NUMS) {
    if (patch[k] === undefined) continue
    const v = patch[k]
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) next[k] = v
    else delete next[k]
  }
  writeJson(SETTINGS_FILE, next)
  return next
}

export type Effective = { apiUrl: string; apiKey: string; slippage: number; sniperGapMs: number; holderWindowS: number; holderDelayS: number; apiKeyFrom: "settings" | "env" | "none" }

/** What the app actually uses: settings.json over .env over the built-in default. */
export function effectiveSettings(): Effective {
  const s = readSettings()
  const envKey = (process.env.TRENCHY_API_KEY || "").trim()
  return {
    apiUrl: (s.apiUrl || process.env.TRENCHY_API_URL || DEFAULT_API_URL).trim().replace(/\/+$/, ""),
    apiKey: s.apiKey || envKey,
    slippage: s.slippage ?? DEFAULTS.slippage,
    sniperGapMs: s.sniperGapMs ?? DEFAULTS.sniperGapMs,
    holderWindowS: s.holderWindowS ?? DEFAULTS.holderWindowS,
    holderDelayS: s.holderDelayS ?? DEFAULTS.holderDelayS,
    apiKeyFrom: s.apiKey ? "settings" : envKey ? "env" : "none",
  }
}
