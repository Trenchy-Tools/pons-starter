import { body, fail, ok } from "@/lib/http"
import { normalizeForm, readLaunches, startLaunch, type LaunchForm } from "@/lib/launch"

export const dynamic = "force-dynamic"

/** GET /api/launch → { launches }: the records in _app/pons-starter/launches.json, newest first. */
export async function GET() {
  return ok({ launches: readLaunches() })
}

/**
 * POST /api/launch (the form) → { id }. Starts the run (lib/launch.ts): trade-local create → sign → send → wait for
 * success → bundle buys at once → snipers staggered → holders over the window. Follow it at GET /api/launch/:id/log.
 * The run refuses (nothing sent) when a wallet file is missing or any wallet is short of ETH.
 */
export async function POST(req: Request) {
  try {
    const form = normalizeForm(await body<LaunchForm>(req))
    return ok({ id: startLaunch(form) })
  } catch (e) {
    return fail(e)
  }
}
