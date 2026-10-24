import { fail, isAddress, ok } from "@/lib/http"
import { trenchy } from "@/lib/settings"

export const dynamic = "force-dynamic"

/** GET /api/trading/token?token=0x… → GET /api/rh/token/:token: name, symbol, venue (pons-curve | uniswap-v4), curve state. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token")
  if (!isAddress(token)) return fail(new Error("token: a 0x address"), 400)
  try {
    return ok(await trenchy().rh.token(token))
  } catch (e) {
    return fail(e)
  }
}
