import { body, fail, isAddress, ok, strings } from "@/lib/http"
import { archiveWallets } from "@/lib/wallets"

/** POST /api/wallets/archive { publicKeys } → move their files to <folder>/archived/ (keys kept, never used again). The ★ wallet is refused. */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[] }>(req)
  const targets = strings(b.publicKeys).filter(isAddress)
  if (!targets.length) return fail(new Error("publicKeys: at least one 0x wallet"), 400)
  try {
    return ok(archiveWallets(targets))
  } catch (e) {
    return fail(e, 409)
  }
}
