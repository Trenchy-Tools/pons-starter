import { simulate } from "@/lib/core/launch"
import { serverEnv } from "@/lib/env"
import { body, fail, ok } from "@/lib/http"
import { normalizeForm, type LaunchForm } from "@/lib/launch"

/**
 * POST /api/launch/simulate (the form) → { predicted, launchFeeEth, expected, simulation, calls }. Checks the dev
 * wallet's balance (GET /api/rh/account; 409 insufficient_funds when short), builds the create (POST /api/rh/trade-local)
 * and runs it on a copy of the chain (POST /api/rh/simulate). `calls` is every request made to the API (the dry run's
 * trace). Nothing is sent.
 */
export async function POST(req: Request) {
  const env = serverEnv()
  env.api.beginTrace()
  try {
    const r = await simulate(env, normalizeForm(await body<LaunchForm>(req)))
    return ok({ ...r, calls: env.api.endTrace() })
  } catch (e) {
    return fail(e)
  }
}
