import { fail, sse } from "@/lib/http"
import { getRun, onLog } from "@/lib/launch"

export const dynamic = "force-dynamic"

/** GET /api/launch/:id/log → server-sent events: every log entry so far, then live ones until the run is done. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const run = getRun(id)
  if (!run) return fail(new Error("no such launch in this server's memory (it may have restarted); see GET /api/launch for the record"), 404)
  return sse(req, (send, close) => {
    for (const e of run.log) send(e)
    if (run.log.some((e) => e.done)) { close(); return () => {} }
    const off = onLog(id, (e) => { send(e); if (e.done) close() })
    return off
  })
}
