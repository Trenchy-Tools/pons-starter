import { fail, ok } from "@/lib/http"
import { trenchy } from "@/lib/settings"

export const dynamic = "force-dynamic"

/** GET /api/transfer/venues → GET /api/transfer/venues on the API: which exchange venues are open right now. */
export async function GET() {
  try {
    return ok(await trenchy().transferVenues())
  } catch (e) {
    return fail(e)
  }
}
