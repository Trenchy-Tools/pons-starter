import { fail, isAddress, ok } from "@/lib/http"
import { trenchy } from "@/lib/settings"

export const dynamic = "force-dynamic"

/** GET /api/wallets/account?wallet=0x… → GET /api/rh/account through the app's client: chainId, nonce, pendingNonce, fees, balanceEth. */
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")
  if (!isAddress(wallet)) return fail(new Error("wallet: a 0x address"), 400)
  try {
    return ok(await trenchy().rh.account(wallet))
  } catch (e) {
    return fail(e)
  }
}
