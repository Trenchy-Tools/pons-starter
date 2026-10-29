import { body, fail, isAddress, ok } from "@/lib/http"
import { collectCreatorFees, creatorFees } from "@/lib/trading"

export const dynamic = "force-dynamic"

/** GET /api/trading/creator-fees?token=0x… → the coin's creator and what it can claim (GET /api/rh/creator-fees: escrow + this curve's pending fees). */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token")
  if (!isAddress(token)) return fail(new Error("token: a 0x address"), 400)
  try {
    return ok(await creatorFees(token))
  } catch (e) {
    return fail(e)
  }
}

/** POST /api/trading/creator-fees { token } → claim them (trade-local collectCreatorFee → [sweep?] claim, signed by the creator → sent → confirmed). */
export async function POST(req: Request) {
  const b = await body<{ token: string }>(req)
  if (!isAddress(b.token)) return fail(new Error("token: a 0x address"), 400)
  try {
    return ok(await collectCreatorFees(b.token))
  } catch (e) {
    return fail(e)
  }
}
