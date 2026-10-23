import { body, fail, ok } from "@/lib/http"
import { fundPlan, normalizeForm, type LaunchForm } from "@/lib/launch"

/** POST /api/launch/fund (the form) → { from, results }: the funding wallet tops every short wallet of the plan up (direct transfers, lib/funding.ts fundDirect). */
export async function POST(req: Request) {
  try {
    const form = normalizeForm({ image: "https://placeholder.invalid/x", ...(await body<LaunchForm>(req)) })
    return ok(await fundPlan(form))
  } catch (e) {
    return fail(e)
  }
}
