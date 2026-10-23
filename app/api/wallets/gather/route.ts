import { gather } from "@/lib/funding"
import { body, fail, isAddress, ok, strings } from "@/lib/http"

/** POST /api/wallets/gather { publicKeys } → { to, results }: each wallet sends its ETH minus a gas reserve to the funding wallet (GET /api/rh/account → sign → POST /api/rh/send). */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[] }>(req)
  const targets = strings(b.publicKeys).filter(isAddress)
  if (!targets.length) return fail(new Error("publicKeys: at least one 0x wallet"), 400)
  try {
    return ok(await gather(targets))
  } catch (e) {
    return fail(e)
  }
}
