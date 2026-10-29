import { fail, isAddress, sse } from "@/lib/http"
import { backfillToken, followToken, onTrade } from "@/lib/trading"

export const dynamic = "force-dynamic"

/**
 * GET /api/trading/feed?token=0x… → server-sent events: the trades seen so far, then the coin's history from
 * GET /api/rh/trades (the dev buy and the bundle included) as a second snapshot, then live trades from the websocket.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token")
  if (!isAddress(token)) return fail(new Error("token: a 0x address"), 400)
  return sse(req, (send) => {
    const seen = followToken(token)
    send({ type: "snapshot", trades: seen })
    void backfillToken(token).then((trades) => send({ type: "snapshot", trades: [...trades] }))
    return onTrade((t) => { if (t.token.toLowerCase() === token.toLowerCase()) send({ type: "trade", trade: t }) })
  })
}
