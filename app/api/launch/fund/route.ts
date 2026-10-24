import { body, fail, ok } from "@/lib/http"
import { fundPlan, normalizeForm, type LaunchForm } from "@/lib/launch"

/** POST /api/launch/fund (the form) → { from, results }: the funding wallet tops every short wallet of the plan up (direct transfers, lib/funding.ts fundDirect). */
export async function POST(req: Request) {
  try {
    const b = await body<LaunchForm>(req)
    // the plan and funding do not need the image yet: an empty one (not uploaded) uses the placeholder
    const form = normalizeForm({ ...b, image: b.image || "https://placeholder.invalid/x" })
    return ok(await fundPlan(form))
  } catch (e) {
    return fail(e)
  }
}
