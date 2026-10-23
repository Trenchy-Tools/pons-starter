import { body, fail, isAddress, ok } from "@/lib/http"
import { setMainWallet } from "@/lib/wallets"

/** POST /api/wallets/main { publicKey } → make that wallet the ★ (saved as `mainWallet` in _app/pons-starter/settings.json). */
export async function POST(req: Request) {
  const b = await body<{ publicKey: string }>(req)
  if (!isAddress(b.publicKey)) return fail(new Error("publicKey: a 0x address"), 400)
  try {
    return ok({ mainWallet: setMainWallet(b.publicKey) })
  } catch (e) {
    return fail(e)
  }
}
