import { body, fail, ok } from "@/lib/http"
import { normalizeForm, simulate, type LaunchForm } from "@/lib/launch"

/**
 * POST /api/launch/simulate (the form) → { predicted, launchFeeEth, expected, simulation }. Checks the dev wallet's
 * balance (GET /api/rh/account; 409 insufficient_funds when short), builds the create (POST /api/rh/trade-local) and
 * runs it on a copy of the chain (POST /api/rh/simulate). Nothing is sent.
 */
export async function POST(req: Request) {
  try {
    return ok(await simulate(normalizeForm(await body<LaunchForm>(req))))
  } catch (e) {
    return fail(e)
  }
}
