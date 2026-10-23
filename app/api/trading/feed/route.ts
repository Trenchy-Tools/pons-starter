import { fail, isAddress, sse } from "@/lib/http"
import { followToken, onTrade } from "@/lib/trading"

export const dynamic = "force-dynamic"

/** GET /api/trading/feed?token=0x… → server-sent events: the coin's trades from the API websocket (subscribeTokenTrade on /api/rh/data), newest first, then live. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token")
  if (!isAddress(token)) return fail(new Error("token: a 0x address"), 400)
  return sse(req, (send) => {
    const seen = followToken(token)
    send({ type: "snapshot", trades: seen })
    return onTrade((t) => { if (t.token.toLowerCase() === token.toLowerCase()) send({ type: "trade", trade: t }) })
  })
}
