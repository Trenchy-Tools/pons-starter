import { body, fail, ok } from "@/lib/http"
import { normalizeForm, planWithBalances, type LaunchForm } from "@/lib/launch"

/**
 * POST /api/launch/plan (the form) → the funding plan: per wallet buy + 0.5 % fee + gas reserve (dev: + pons launch
 * fee), live balance (GET /api/rh/balances?wallets=) and shortfall. Creates (and backs up) missing buyer wallets.
 */
export async function POST(req: Request) {
  try {
    const b = await body<LaunchForm>(req)
    // the plan and funding do not need the image yet: an empty one (not uploaded) uses the placeholder
    const form = normalizeForm({ ...b, image: b.image || "https://placeholder.invalid/x" })
    const { resolved, ...plan } = await planWithBalances(form)
    return ok({ ...plan, dev: resolved.dev.publicKey, exempt: resolved.exempt.length, wallets: { bundle: resolved.bundle, snipers: resolved.snipers, holders: resolved.holders } })
  } catch (e) {
    return fail(e)
  }
}
