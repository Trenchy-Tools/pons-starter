/**
 * The errors every flow can throw, and the one JSON shape they leave the app in. Shared by the server routes
 * (lib/http.ts, local mode) and the browser engine (lib/browser/engine.ts, demo mode). No node imports.
 *
 *   ApiError          the TrenchyTools API refused: { error, code, hint?, docs? }, status as sent
 *   AppError          the app's own refusal with a stable code (insufficient_funds, no_funding_wallet, bad_request…)
 *   NotBackedUpError  the backup rule: a wallet whose key is not backed up is never funded or used (409 not_backed_up)
 *   RouteError        a refusal of the request itself (a missing field): its own status, usually 400
 */

/** Every API error body is `{ error, code, hint?, docs? }`. All of it rides along here; show it verbatim, branch on `code`. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public hint?: string, public docs?: string) {
    super(message)
    this.name = "ApiError"
  }
  toJSON() {
    return { error: this.message, code: this.code, hint: this.hint, docs: this.docs, status: this.status }
  }
}

/** An error with a stable code, in the API's shape, for the app's own refusals (insufficient_funds, no_funding_wallet…). */
export class AppError extends Error {
  constructor(message: string, public code: string, public status = 400, public hint?: string) {
    super(message)
  }
}

/**
 * The backup rule's refusal. Local mode says which folder is missing the file (lib/wallets.ts); demo mode says the key
 * has not been downloaded yet (lib/browser/keystore.ts). Same code, same status, everywhere.
 */
export class NotBackedUpError extends Error {
  code = "not_backed_up" as const
  constructor(public publicKey: string, message: string, public hint: string, public dir?: string) {
    super(message)
    this.name = "NotBackedUpError"
  }
}

/** A refusal of the request itself (a missing field): answered with its own status, usually 400, as `{ error }`. */
export class RouteError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
    this.name = "RouteError"
  }
}

/** Any thrown value → the status and JSON body a route answers with: `{ error, code?, hint?, docs?, … }`. */
export function errorBody(err: unknown, status?: number): { status: number; body: Record<string, unknown> } {
  if (err instanceof NotBackedUpError) return { status: 409, body: { error: err.message, code: err.code, hint: err.hint, publicKey: err.publicKey, ...(err.dir ? { dir: err.dir } : {}) } }
  if (err instanceof ApiError) return { status: err.status >= 400 && err.status < 600 ? err.status : 502, body: { error: err.message, code: err.code, hint: err.hint, docs: err.docs } }
  if (err instanceof AppError) return { status: err.status, body: { error: err.message, code: err.code, ...(err.hint ? { hint: err.hint } : {}) } }
  if (err instanceof RouteError) return { status: err.status, body: { error: err.message } }
  const message = err instanceof Error ? err.message : err && typeof err === "object" && "error" in err ? String((err as { error: unknown }).error) : String(err)
  const code = (err as { code?: string })?.code
  const hint = (err as { hint?: string })?.hint
  return { status: status ?? 500, body: { error: message, ...(code ? { code } : {}), ...(hint ? { hint } : {}) } }
}

/** The answer of a route that does not exist in this mode (demo mode: every server route; see lib/http.ts demoGuard). */
export const DEMO_MODE_BODY = {
  error: "This hosted demo keeps no server state: wallets, launches and trades run in your browser.",
  code: "demo_mode",
  hint: "Use the pages of this app (they call the TrenchyTools API straight from the browser), or clone the repo to run it on your own machine: https://github.com/Trenchy-Tools/trenchytools-pons-launcher",
}
