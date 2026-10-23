import { fail, isAddress, ok } from "@/lib/http"
import { creatorOf, holdings } from "@/lib/trading"

export const dynamic = "force-dynamic"

/** GET /api/trading/holdings?token=0x… → { token, creator, holdings: [wallet + eth + tokens] } (GET /api/rh/balances). */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token")
  if (!isAddress(token)) return fail(new Error("token: a 0x address"), 400)
  try {
    return ok({ token, creator: creatorOf(token), holdings: await holdings(token) })
  } catch (e) {
    return fail(e)
  }
}
