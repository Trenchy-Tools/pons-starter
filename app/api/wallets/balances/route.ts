import { fail, isAddress, ok } from "@/lib/http"
import { holdings } from "@/lib/trading"
import { trenchy } from "@/lib/trenchy"
import { listWallets } from "@/lib/wallets"

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
    let rows: Array<{ publicKey: string; native: number; eth: number; tokens?: number }>
    if (token && isAddress(token)) rows = (await holdings(token)).map((h) => ({ publicKey: h.publicKey, native: h.eth, eth: h.eth, tokens: h.tokens }))
    else {
      const wallets = listWallets()
      const eth = wallets.length ? await trenchy().rh.ethBalances(wallets.map((w) => w.publicKey)) : new Map<string, number>()
      rows = wallets.map((w) => ({ publicKey: w.publicKey, native: eth.get(w.publicKey.toLowerCase()) ?? 0, eth: eth.get(w.publicKey.toLowerCase()) ?? 0 }))
    }
    return ok({ token: token ?? null, rows, balances: rows })
  } catch (e) {
    return fail(e)
  }
}
