import { fail, isAddress, ok } from "@/lib/http"
import { balanceRows } from "@/lib/trading"

export const dynamic = "force-dynamic"

/**
 * GET /api/wallets/balances[?token=0x…] → { rows: [{ publicKey, native, eth, tokens? }], balances }.
 * ETH for every wallet in one call (GET /api/rh/balances?wallets=a,b,…); with `token`, that coin's balance too
 * (GET /api/rh/balances?wallet=&tokens= per wallet). `native` is the ETH balance under the name the shared pages read
 * (the pump.fun starter fills it with SOL); `balances` is the same list under its old name.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token")
  try {
    const rows = await balanceRows(token && isAddress(token) ? token : null)
    return ok({ token: token ?? null, rows, balances: rows })
  } catch (e) {
    return fail(e)
  }
}
