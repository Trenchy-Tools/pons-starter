import { sendDirect } from "@/lib/funding"
import { body, fail, isAddress, ok, strings } from "@/lib/http"

/**
 * POST /api/wallets/send { publicKeys, to, amount } → { to, results }: a plain ETH transfer from each selected wallet to
 * `to` (any 0x address). `amount` is ETH, or "max" for the whole balance minus the transfer's gas. Signed by each source
 * with GET /api/rh/account data, sent with POST /api/rh/send, confirmed with GET /api/rh/tx. 409 not_backed_up when a
 * source's key file is missing; nothing is sent then.
 */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[]; to: string; amount: number | string }>(req)
  const from = strings(b.publicKeys).filter(isAddress)
  if (!from.length) return fail(new Error("publicKeys: at least one 0x wallet"), 400)
  if (!isAddress(b.to)) return fail(new Error("to: a 0x address"), 400)
  const amount = b.amount === "max" ? "max" : Number(b.amount)
  if (amount !== "max" && !(amount > 0)) return fail(new Error('amount: ETH, or "max"'), 400)
  try {
    return ok(await sendDirect(from, b.to, amount))
  } catch (e) {
    return fail(e)
  }
}
