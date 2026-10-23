"use client"

/**
 * The browser side of the app's own routes (app/api/*). Every failure is an ApiFailure carrying exactly what the route
 * (and, through it, the TrenchyTools API) returned: error · code · hint · docs. Show it with <ApiErrorView>.
 */
export type ApiFailure = { error: string; code?: string; hint?: string; docs?: string; status: number; publicKey?: string; dir?: string }

export class ApiFailureError extends Error {
  constructor(public failure: ApiFailure) {
    super(failure.error)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: init.body && !(init.body instanceof FormData) ? { "content-type": "application/json", ...(init.headers ?? {}) } : init.headers })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(text) } catch { /* not JSON */ }
  if (!res.ok) throw new ApiFailureError({ error: String(data.error ?? `${res.status} ${res.statusText}`), code: data.code as string, hint: data.hint as string, docs: data.docs as string, status: res.status, publicKey: data.publicKey as string, dir: data.dir as string })
  return data as T
}

export const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) })
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) })
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" })

export const failureOf = (e: unknown): ApiFailure => (e instanceof ApiFailureError ? e.failure : { error: e instanceof Error ? e.message : String(e), status: 0 })

/** Subscribe to one of the app's server-sent-event routes. Returns the unsubscribe. */
export function events<T>(path: string, onEvent: (e: T) => void, onEnd?: () => void): () => void {
  const es = new EventSource(path)
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data) as T) } catch { /* ignore */ } }
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) onEnd?.() }
  return () => es.close()
}
