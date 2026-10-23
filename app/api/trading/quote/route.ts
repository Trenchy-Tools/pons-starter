import { fail, isAddress, num, ok } from "@/lib/http"
import { trenchy } from "@/lib/trenchy"

export const dynamic = "force-dynamic"

/** GET /api/trading/quote?token&action=buy|sell&amount[&wallet] → GET /api/rh/quote: the numbers before a trade (buys in ETH, sells in tokens; snipe tax depends on the wallet). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const token = q.get("token"), wallet = q.get("wallet") ?? undefined
  const action = q.get("action") === "sell" ? "sell" : "buy"
  const amount = num(q.get("amount"), 0)
  if (!isAddress(token)) return fail(new Error("token: a 0x address"), 400)
  if (!(amount > 0)) return fail(new Error("amount must be greater than zero"), 400)
  try {
    return ok(await trenchy().rh.quote({ token, action, amount, wallet: isAddress(wallet) ? wallet : undefined }))
  } catch (e) {
    return fail(e)
  }
}
