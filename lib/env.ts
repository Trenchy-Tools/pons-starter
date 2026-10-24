/**
 * Local mode's Env (lib/core/env.ts): the wallet folder, launches.json and the settings, with the API client built
 * from them. The shared flows in lib/core/* run on it; the browser engine builds its own Env from localStorage
 * (lib/browser/engine.ts).
 */
import type { Env, LaunchRecord } from "./core/launch"
import { LAUNCHES_FILE, readJson, writeJson } from "./paths"
import { effectiveSettings, trenchy } from "./settings"
import { walletStore } from "./wallets"

/** launches.json in _app/pons-starter/, newest first (at most 200). */
export const readLaunches = (): LaunchRecord[] => readJson<LaunchRecord[]>(LAUNCHES_FILE, [])
export function saveLaunch(rec: LaunchRecord): void {
  const all = readLaunches().filter((l) => l.id !== rec.id)
  all.unshift(rec)
  writeJson(LAUNCHES_FILE, all.slice(0, 200))
}

/** The Env with the current settings. Cheap: build one per request. */
export function serverEnv(): Env {
  const s = effectiveSettings()
  return {
    api: trenchy(),
    wallets: walletStore,
    launches: { list: readLaunches, save: saveLaunch },
    slippage: s.slippage,
    sniperGapMs: s.sniperGapMs,
    holderWindowS: s.holderWindowS,
    holderDelayS: s.holderDelayS,
  }
}
