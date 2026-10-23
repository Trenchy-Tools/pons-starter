import { body, fail, isAddress, num, ok, strings } from "@/lib/http"
import { addTimer, cancelTimer, clearFinished, listTimers } from "@/lib/timers"
import { assertBackedUp } from "@/lib/wallets"

export const dynamic = "force-dynamic"

/** GET /api/trading/timers[?token=] → { timers } (server memory). */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? undefined
  return ok({ timers: listTimers(token) })
}

/** POST /api/trading/timers { token, publicKeys, percent, minutes } → the rule: "at +minutes sell percent % from these wallets". */
export async function POST(req: Request) {
  const b = await body<{ token: string; publicKeys: string[]; percent: number; minutes: number }>(req)
  const wallets = strings(b.publicKeys).filter(isAddress)
  if (!isAddress(b.token) || !wallets.length) return fail(new Error("token (0x) and publicKeys (0x) are required"), 400)
  try {
    for (const pk of wallets) assertBackedUp(pk) // a rule for an unbacked wallet is refused when it is made, not when it fires
    return ok({ timer: addTimer({ token: b.token, publicKeys: wallets, percent: num(b.percent, 100), minutes: num(b.minutes, 0) }) })
  } catch (e) {
    return fail(e)
  }
}

/** DELETE /api/trading/timers?id=… cancels a pending rule; without id, forgets finished ones. */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return ok({ cleared: clearFinished() })
  const t = cancelTimer(id)
  return t ? ok({ timer: t }) : fail(new Error("no such timer"), 404)
}
