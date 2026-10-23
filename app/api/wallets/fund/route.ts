import { fundDirect } from "@/lib/funding"
import { body, fail, isAddress, num, ok, strings } from "@/lib/http"

/**
 * POST /api/wallets/fund { publicKeys: string[], amount } → { from, results }: a plain ETH transfer from the ★ wallet
 * to each wallet ({ to, value, gas: 21000 } signed with GET /api/rh/account data, POST /api/rh/send, confirmed with
 * GET /api/rh/tx). `amountEth` is the old name of `amount`. Refused with 409 not_backed_up for a wallet whose file is
 * missing; nothing is sent to anyone then.
 */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[]; amount: number; amountEth: number }>(req)
  const targets = strings(b.publicKeys).filter(isAddress)
  const amount = num(b.amount ?? b.amountEth, 0)
  if (!targets.length) return fail(new Error("publicKeys: at least one 0x wallet"), 400)
  if (!(amount > 0)) return fail(new Error("amount must be greater than zero"), 400)
  try {
    return ok({ amountEth: amount, ...(await fundDirect(targets.map((publicKey) => ({ publicKey, eth: amount })))) })
  } catch (e) {
    return fail(e)
  }
}
