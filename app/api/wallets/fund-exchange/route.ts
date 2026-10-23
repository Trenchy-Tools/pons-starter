import { fundViaExchange } from "@/lib/funding"
import { body, fail, isAddress, num, ok, strings } from "@/lib/http"
import type { TransferMode } from "@/lib/trenchy"

/**
 * POST /api/wallets/fund-exchange { publicKeys, amountEth, mode?: float|fixed|private, venue?: auto|random|<exchange> }
 * → { from, batchId, legs }: POST /api/transfer/batch from the funding wallet (from.chain "rh"), each leg's EVM deposit
 * signed and sent (POST /api/rh/send), then POST /api/transfer/:id/sent. Follow a leg with GET /api/transfer/:id.
 * Exchange routing reduces on-chain linkability between the wallets; it is not anonymity.
 */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[]; amount: number; amountEth: number; mode: TransferMode; venue: string }>(req)
  const targets = strings(b.publicKeys).filter(isAddress)
  const amount = num(b.amount ?? b.amountEth, 0)
  if (!targets.length) return fail(new Error("publicKeys: at least one 0x wallet"), 400)
  if (!(amount > 0)) return fail(new Error("amount must be greater than zero"), 400)
  const mode: TransferMode = b.mode === "fixed" || b.mode === "private" ? b.mode : "float"
  try {
    return ok(await fundViaExchange(targets.map((publicKey) => ({ publicKey, eth: amount })), mode, typeof b.venue === "string" && b.venue ? b.venue : "random"))
  } catch (e) {
    return fail(e)
  }
}
