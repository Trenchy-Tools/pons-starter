import { body, fail, isAddress, num, ok } from "@/lib/http"
import { sell } from "@/lib/trading"

/** POST /api/trading/sell { publicKey, token, percent } → the sell (trade-local "NN%" → [approve] → sell → fee, approve confirmed first). 409 not_backed_up without the file. */
export async function POST(req: Request) {
  const b = await body<{ publicKey: string; token: string; percent: number }>(req)
  if (!isAddress(b.publicKey) || !isAddress(b.token)) return fail(new Error("publicKey and token: 0x addresses"), 400)
  try {
    return ok(await sell(b.publicKey, b.token, num(b.percent, 100)))
  } catch (e) {
    return fail(e)
  }
}
