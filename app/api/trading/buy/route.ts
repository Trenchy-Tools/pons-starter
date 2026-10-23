import { body, fail, isAddress, num, ok } from "@/lib/http"
import { buy } from "@/lib/trading"

/** POST /api/trading/buy { publicKey, token, amount } → the buy in ETH (trade-local → sign → POST /api/rh/send → GET /api/rh/tx). `eth` is the old name of `amount`. 409 not_backed_up without the file. */
export async function POST(req: Request) {
  const b = await body<{ publicKey: string; token: string; amount: number; eth: number }>(req)
  if (!isAddress(b.publicKey) || !isAddress(b.token)) return fail(new Error("publicKey and token: 0x addresses"), 400)
  const eth = num(b.amount ?? b.eth, 0)
  if (!(eth > 0)) return fail(new Error("amount must be greater than zero"), 400)
  try {
    return ok(await buy(b.publicKey, b.token, eth))
  } catch (e) {
    return fail(e)
  }
}
