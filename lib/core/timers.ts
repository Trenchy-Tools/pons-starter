/**
 * Timed sells: "at +N minutes sell X % from these wallets". The rule and its life cycle, shared by local mode
 * (lib/timers.ts: rules in server memory) and demo mode (lib/browser/engine.ts: rules in localStorage, fired by the
 * open tab). Both fire through the same sell path (lib/core/trading.ts sellAll: one wallet after the other, approve
 * confirmed before each sell). No node imports.
 */
import type { SellAllResult } from "./trading"

export type TimerRule = {
  id: string
  token: string
  publicKeys: string[]
  percent: number
  createdAt: number
  dueAt: number
  status: "pending" | "running" | "done" | "cancelled" | "error"
  result?: SellAllResult
  error?: string
}

/** A new pending rule, `minutes` from now. Throws when no wallet is picked. */
export function newTimerRule(p: { token: string; publicKeys: string[]; percent: number; minutes: number }): TimerRule {
  if (!p.publicKeys.length) throw new Error("Pick at least one wallet")
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    token: p.token, publicKeys: p.publicKeys, percent: Math.max(1, Math.min(100, Math.round(p.percent))),
    createdAt: Date.now(), dueAt: Date.now() + Math.max(0, p.minutes) * 60_000, status: "pending",
  }
}

/** Run a due rule (status running → done | error), in place. */
export async function fireRule(rule: TimerRule, sellAll: (publicKeys: string[], token: string, percent: number) => Promise<SellAllResult>): Promise<TimerRule> {
  rule.status = "running"
  try {
    rule.result = await sellAll(rule.publicKeys, rule.token, rule.percent)
    rule.status = "done"
  } catch (e) {
    rule.status = "error"
    rule.error = e instanceof Error ? e.message : String(e)
  }
  return rule
}

export const isFinished = (r: TimerRule) => r.status !== "pending" && r.status !== "running"

/** Rules of one coin (any letter case), soonest first. */
export const forToken = (rules: TimerRule[], token?: string | null): TimerRule[] =>
  rules.filter((r) => !token || r.token.toLowerCase() === token.toLowerCase()).sort((a, b) => a.dueAt - b.dueAt)
