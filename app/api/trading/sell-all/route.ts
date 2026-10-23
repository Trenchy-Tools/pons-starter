import { body, fail, isAddress, num, ok, strings } from "@/lib/http"
import { sellAll } from "@/lib/trading"
import { assertBackedUp } from "@/lib/wallets"

/** POST /api/trading/sell-all { publicKeys, token, percent } → { results }: one wallet after the other (approve confirmed before each sell). All files checked first. */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[]; token: string; percent: number }>(req)
  const wallets = strings(b.publicKeys).filter(isAddress)
  if (!wallets.length || !isAddress(b.token)) return fail(new Error("publicKeys (0x) and token (0x) are required"), 400)
  try {
    for (const pk of wallets) assertBackedUp(pk)
    return ok({ results: await sellAll(wallets, b.token, num(b.percent, 100)) })
  } catch (e) {
    return fail(e)
  }
}
