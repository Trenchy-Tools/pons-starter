import { fail, ok } from "@/lib/http"
import { trenchy } from "@/lib/trenchy"

export const dynamic = "force-dynamic"

/** GET /api/transfer/:id → GET /api/transfer/:id on the API: awaiting_deposit → exchanging → completed (payoutHash), or a failure with `help`. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    return ok(await trenchy().transferStatus(id))
  } catch (e) {
    return fail(e)
  }
}
