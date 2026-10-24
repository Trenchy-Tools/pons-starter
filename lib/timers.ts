/**
 * Timed sells in local mode: rules live in server memory (they survive page reloads, not a server restart) and fire
 * through the same sell path as the Trading page (lib/trading.ts sellAll: one wallet after the other, approve
 * confirmed before each sell). The rule itself is lib/core/timers.ts.
 */
import { fireRule, forToken, isFinished, newTimerRule, type TimerRule } from "./core/timers"
import { serverState } from "./paths"
import { sellAll } from "./trading"

export type { TimerRule } from "./core/timers"

const state = serverState("timers", () => ({ rules: new Map<string, TimerRule & { handle?: ReturnType<typeof setTimeout> }>() }))

const view = ({ handle: _h, ...rule }: TimerRule & { handle?: unknown }): TimerRule => { void _h; return rule }

export const listTimers = (token?: string): TimerRule[] => forToken([...state.rules.values()].map(view), token)

/** Schedule a rule; `minutes` from now. */
export function addTimer(p: { token: string; publicKeys: string[]; percent: number; minutes: number }): TimerRule {
  const rule: TimerRule & { handle?: ReturnType<typeof setTimeout> } = newTimerRule(p)
  rule.handle = setTimeout(() => void fire(rule.id), rule.dueAt - Date.now())
  state.rules.set(rule.id, rule)
  return view(rule)
}

async function fire(id: string): Promise<void> {
  const rule = state.rules.get(id)
  if (!rule || rule.status !== "pending") return
  await fireRule(rule, sellAll)
}

export function cancelTimer(id: string): TimerRule | null {
  const rule = state.rules.get(id)
  if (!rule) return null
  if (rule.status === "pending") {
    clearTimeout(rule.handle)
    rule.status = "cancelled"
  }
  return view(rule)
}

/** Forget finished rules (done / cancelled / error). */
export function clearFinished(): number {
  let n = 0
  for (const [id, r] of state.rules) if (isFinished(r)) { state.rules.delete(id); n++ }
  return n
}
