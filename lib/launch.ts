/**
 * A pons launch in local mode: the executor in lib/core/launch.ts (create → wait for success → bundle buys at once →
 * snipers staggered → holders over the window) run by this server on the wallet folder (lib/env.ts).
 *
 * Progress goes to an in-memory log the route streams as server-sent events (GET /api/launch/:id/log); the result
 * lands in `_app/pons-starter/launches.json`.
 */
import * as core from "./core/launch"
import { readLaunches, serverEnv } from "./env"
import { serverState } from "./paths"
import type { LaunchForm, LaunchRecord, LogEntry } from "./core/launch"

export { API_FEE_PCT, GAS_RESERVE_ETH, LAUNCH_FEE_ETH, MAX_BUNDLE, MAX_EXEMPT, fundingPlan, groupSize, metadataOf, normalizeForm } from "./core/launch"
export type { Buyer, BuyerGroup, CreatePreview, LaunchForm, LaunchRecord, LogEntry, Picked, Plan, PlanRow, Resolved, SimulateResult } from "./core/launch"
export { readLaunches }

// ── the flows, on the folder ────────────────────────────────────────────────

export const resolveWallets = (f: LaunchForm) => core.resolveWallets(serverEnv(), f)
export const planWithBalances = (f: LaunchForm) => core.planWithBalances(serverEnv(), f)
export const fundPlan = (f: LaunchForm) => core.fundPlan(serverEnv(), f)
export const simulate = (f: LaunchForm) => core.simulate(serverEnv(), f)

// ── the run, in server memory ───────────────────────────────────────────────

type Run = { record: LaunchRecord; log: LogEntry[]; listeners: Set<(e: LogEntry) => void> }
const runs = serverState("launches", () => new Map<string, Run>())

export const getRun = (id: string): Run | undefined => runs.get(id)
export function onLog(id: string, cb: (e: LogEntry) => void): () => void {
  const run = runs.get(id)
  if (!run) return () => {}
  run.listeners.add(cb)
  return () => run.listeners.delete(cb)
}

/** Start a launch; returns its id at once. Follow it with onLog / the SSE route. */
export function startLaunch(f: LaunchForm): string {
  const record = core.newRecord(f)
  const run: Run = { record, log: [], listeners: new Set() }
  runs.set(record.id, run)
  const log: core.Log = (stage, msg, extra = {}) => {
    const e: LogEntry = { t: Date.now(), stage, msg, ...extra }
    run.log.push(e)
    for (const cb of run.listeners) cb(e)
  }
  void core.execute(serverEnv(), record, f, log)
  return record.id
}
