/**
 * Route-handler helpers. Every error leaves the server in the same shape the API uses: { error, code?, hint?, docs? }.
 * An ApiError from lib/trenchy.ts is passed through with its status; a NotBackedUpError is 409 not_backed_up.
 */
import { BACKUP_DIR } from "./paths"
import { ApiError } from "./trenchy"
import { NotBackedUpError } from "./wallets"

export const ok = (data: unknown, status = 200) => Response.json(data, { status })

export function fail(err: unknown, status?: number): Response {
  if (err instanceof NotBackedUpError) return Response.json({ error: err.message, code: err.code, hint: err.hint, publicKey: err.publicKey, dir: BACKUP_DIR }, { status: 409 })
  if (err instanceof ApiError) return Response.json({ error: err.message, code: err.code, hint: err.hint, docs: err.docs }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 })
  if (err instanceof AppError) return Response.json({ error: err.message, code: err.code, ...(err.hint ? { hint: err.hint } : {}) }, { status: err.status })
  const message = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string })?.code
  const hint = (err as { hint?: string })?.hint
  return Response.json({ error: message, ...(code ? { code } : {}), ...(hint ? { hint } : {}) }, { status: status ?? 500 })
}

/** An error with a stable code, in the API's shape, for the app's own refusals (insufficient_funds, no_funding_wallet…). */
export class AppError extends Error {
  constructor(message: string, public code: string, public status = 400, public hint?: string) {
    super(message)
  }
}

/** The JSON body of a request, {} when there is none. */
export async function body<T extends Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>
  } catch {
    return {}
  }
}

/** A number from a form field, or the default. */
export const num = (v: unknown, d: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [])

export const isAddress = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)

/**
 * Server-sent events from a route handler: `start` receives a `send` and returns a cleanup. The stream closes when
 * the client disconnects (request.signal) or when `close` is called.
 */
export function sse(req: Request, start: (send: (data: unknown) => void, close: () => void) => () => void): Response {
  let cleanup: (() => void) | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let open = true
      const close = () => {
        if (!open) return
        open = false
        if (timer) clearInterval(timer)
        cleanup?.()
        try { controller.close() } catch { /* already closed */ }
      }
      const send = (data: unknown) => {
        if (!open) return
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch { close() }
      }
      timer = setInterval(() => { if (open) try { controller.enqueue(enc.encode(": ping\n\n")) } catch { close() } }, 15_000)
      req.signal.addEventListener("abort", close)
      cleanup = start(send, close)
    },
    cancel() {
      if (timer) clearInterval(timer)
      cleanup?.()
    },
  })
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } })
}
