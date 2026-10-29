"use client"

/**
 * The browser engine of demo mode: this app's /api/* routes, answered inside the visitor's tab.
 *
 * Same paths, same request bodies, same JSON answers and error shapes as the route handlers in app/api/** (local
 * mode), so the pages run unchanged on top of it (lib/browser/demo.ts appFetch / appEvents is the switch). The flows
 * are the shared ones in lib/core/* (launch executor, trading, funding, timers, the signer); only the storage differs:
 *
 *   wallets           lib/browser/keystore.ts (localStorage, backup rule: not usable until downloaded)
 *   API key           lib/browser/api-key.ts (one per visitor, created on first visit)
 *   launches + log    localStorage <prefix>.launches / <prefix>.launchLog.<id>; a launch runs in this tab
 *   timed sells       localStorage <prefix>.timers; fired by any open tab of the app, resumed on reload
 *   settings          localStorage <prefix>.settings (slippage, sniper gap, holder window / delay)
 *
 * Signing needs chain data, and the API has it: GET /api/rh/account (pendingNonce, fees, chainId) → viem
 * `account.signTransaction` per transaction, nonce + 1 per transaction of a run → POST /api/rh/send → GET /api/rh/tx/:hash
 * (lib/core/evm.ts sendAll). Every call goes from the browser straight to https://api.trenchy.tools with the visitor's
 * key (lib/trenchy.ts, the same client class the server uses), the live-trades websocket too. Nothing touches the
 * app's own server.
 *
 * Loaded only in demo mode (a dynamic import in demo.ts).
 */
import * as launch from "../core/launch"
import * as trading from "../core/trading"
import { fundDirect, fundViaExchange, gather } from "../core/funding"
import { DEFAULTS, type WalletStore } from "../core/env"
import { RouteError, errorBody } from "../core/errors"
import { isAddress, num, strings } from "../core/form"
import { fireRule, forToken, isFinished, newTimerRule, type TimerRule } from "../core/timers"
import { APP_NAME, CHAIN, cleanLabel, isRole, newLabel, same, stampAt, type Role, type WalletInfo } from "../core/wallet-record"
import { ApiError, Trenchy, type TransferMode } from "../trenchy"
import { ensureApiKey, keyError, maskKey, readApiKey, replaceApiKey, setApiKey, type KeyOptions } from "./api-key"
import { DEMO_API_URL, DEMO_KEY_LABEL, KEYS_HOME, STORE_PREFIX, type EventStream } from "./demo"
import { createKeystore, type KeyView } from "./keystore"
import { generateKey, parseSecret, signerOf } from "./signer-evm"

const P = STORE_PREFIX
const KEY_OPTS: KeyOptions = { storageKey: `${P}.apiKey`, apiUrl: DEMO_API_URL, label: DEMO_KEY_LABEL }

// ── small storage helpers (settings, records) ───────────────────────────────

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    throw new Error(`This browser refused to store the data (${e instanceof Error ? e.message : e})`)
  }
}

const NUMS = ["slippage", "sniperGapMs", "holderWindowS", "holderDelayS"] as const
type BrowserSettings = Partial<Record<(typeof NUMS)[number], number>>
const okNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0
const settings = () => {
  const s = load<BrowserSettings>(`${P}.settings`, {})
  return { slippage: okNum(s.slippage) ? s.slippage : DEFAULTS.slippage, sniperGapMs: okNum(s.sniperGapMs) ? s.sniperGapMs : DEFAULTS.sniperGapMs, holderWindowS: okNum(s.holderWindowS) ? s.holderWindowS : DEFAULTS.holderWindowS, holderDelayS: okNum(s.holderDelayS) ? s.holderDelayS : DEFAULTS.holderDelayS }
}

/** The API client with the visitor's key (the same class the server uses with its key). */
const api = () => new Trenchy(DEMO_API_URL, readApiKey(KEY_OPTS) ?? "")

// ── wallets: the keystore as the store the shared flows use ─────────────────

const ks = createKeystore({ prefix: P, chain: CHAIN, app: APP_NAME, fileTag: "pons" })

/** An address as the keystore stores it (checksummed), whatever letter case the caller used. */
const canon = (publicKey: string): string => ks.list().find((w) => same(w.publicKey, publicKey))?.publicKey ?? publicKey

const info = (w: KeyView): WalletInfo & { backedUp: boolean } => ({ publicKey: w.publicKey, chain: w.chain, role: isRole(w.role) ? w.role : "trader", label: w.label, createdAt: w.createdAt, app: w.app, file: KEYS_HOME, backedUp: w.backedUp })

function createWallets(count: number, role: Role = "trader", label?: string) {
  const n = Math.min(Math.max(Math.floor(count) || 1, 1), 100)
  const start = ks.seen() + 1
  const out: Array<WalletInfo & { backedUp: boolean; path: string }> = []
  for (let i = 0; i < n; i++) {
    const k = generateKey()
    const { wallet } = ks.add({ ...k, chain: CHAIN, role, label: newLabel(label, n, i, start), createdAt: stampAt(i), app: APP_NAME })
    out.push({ ...info(wallet), path: KEYS_HOME })
  }
  return out
}

const walletStore: WalletStore = {
  place: "browser",
  list: (role) => ks.list().map(info).filter((w) => !role || w.role === role),
  get: (pk) => { const w = ks.get(canon(pk)); return w ? info(w) : null },
  main: () => { const pk = ks.main(); const w = pk ? ks.get(pk) : null; return w ? info(w) : null },
  assertBackedUp: (pk) => ks.assertBackedUp(canon(pk)),
  accountOf: (pk) => { const c = canon(pk); return signerOf(c, ks.signerSecret(c)) },
  create: (count, role, label) => createWallets(count, role, label),
}

// ── launches ────────────────────────────────────────────────────────────────

/** Newest first, at most 200 (as launches.json in local mode). */
const readLaunches = () => load<launch.LaunchRecord[]>(`${P}.launches`, [])
function saveLaunch(rec: launch.LaunchRecord): void {
  save(`${P}.launches`, [rec, ...readLaunches().filter((l) => l.id !== rec.id)].slice(0, 200))
}

/** The Env the shared flows run on, with the current key and settings. Cheap: build one per request. */
function env(): launch.Env {
  return { api: api(), wallets: walletStore, launches: { list: readLaunches, save: saveLaunch }, ...settings() }
}

// ── launch log: in memory, mirrored to localStorage so a reload still shows it ─────────────────────────────────────

const logs = { entries: new Map<string, launch.LogEntry[]>(), listeners: new Map<string, Set<(e: launch.LogEntry) => void>>() }
const entriesOf = (id: string): launch.LogEntry[] => logs.entries.get(id) ?? load<launch.LogEntry[]>(`${P}.launchLog.${id}`, [])
function logger(id: string): launch.Log {
  return (stage, msg, extra = {}) => {
    const e: launch.LogEntry = { t: Date.now(), stage, msg, ...extra }
    const list = [...entriesOf(id), e]
    logs.entries.set(id, list)
    try { save(`${P}.launchLog.${id}`, list.slice(-300)) } catch { /* the log is a convenience */ }
    for (const cb of logs.listeners.get(id) ?? []) cb(e)
  }
}
function subscribeLaunch(id: string, cb: (e: launch.LogEntry) => void): () => void {
  if (!logs.listeners.has(id)) logs.listeners.set(id, new Set())
  logs.listeners.get(id)!.add(cb)
  return () => logs.listeners.get(id)?.delete(cb)
}

const locks = () => (typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : null)
const launchLock = (id: string) => `${P}.launch.${id}`

/** Run a launch in this tab, holding a lock so another tab (or a reload) can tell it is still running. */
function runInTab(rec: launch.LaunchRecord, form: launch.LaunchForm): void {
  const go = () => launch.execute(env(), rec, form, logger(rec.id))
  const l = locks()
  if (l) void l.request(launchLock(rec.id), go)
  else void go()
}

/** A launch still "running" whose tab is gone (no lock held) was interrupted: say so on the record and in its log. */
async function recoverLaunches(): Promise<void> {
  const l = locks()
  if (!l) return
  const held = new Set(((await l.query()).held ?? []).map((x) => x.name))
  for (const rec of readLaunches()) {
    if (rec.status !== "running" || held.has(launchLock(rec.id))) continue
    rec.status = "failed"
    rec.error = "Interrupted: the tab running this launch was closed. Check the coin and the wallets before trying again."
    saveLaunch(rec)
    logger(rec.id)("failed", rec.error, { level: "error", done: true })
  }
}

// ── timed sells: localStorage, fired by whichever open tab gets the rule's lock first ──────────────────────────────

const readTimers = () => load<TimerRule[]>(`${P}.timers`, [])
function saveTimer(rule: TimerRule): void {
  const all = readTimers()
  const i = all.findIndex((r) => r.id === rule.id)
  if (i >= 0) all[i] = rule
  else all.push(rule)
  save(`${P}.timers`, all)
}
const timerLock = (id: string) => `${P}.timer.${id}`
const firing = new Set<string>()

async function fireTimer(id: string): Promise<void> {
  const run = async () => {
    const rule = readTimers().find((r) => r.id === id) // re-read: another tab may have fired it
    if (!rule || rule.status !== "pending") return
    rule.status = "running"
    saveTimer(rule)
    await fireRule(rule, (pks, token, pct) => trading.sellAll(env(), pks, token, pct))
    saveTimer(rule)
  }
  if (firing.has(id)) return
  firing.add(id)
  try {
    const l = locks()
    if (l) await l.request(timerLock(id), { ifAvailable: true }, async (lock) => { if (lock) await run() })
    else await run()
  } finally {
    firing.delete(id)
  }
}

/** Every 2 s: fire the rules that are due. A rule left "running" by a closed tab is marked interrupted. */
async function startTimers(): Promise<void> {
  const l = locks()
  if (l) {
    const held = new Set(((await l.query()).held ?? []).map((x) => x.name))
    for (const r of readTimers()) {
      if (r.status === "running" && !held.has(timerLock(r.id))) {
        r.status = "error"
        r.error = "Interrupted: the tab was closed while this sell ran. Check the balances before setting it again."
        saveTimer(r)
      }
    }
  }
  const tick = () => { for (const r of readTimers()) if (r.status === "pending" && r.dueAt <= Date.now()) void fireTimer(r.id) }
  tick()
  setInterval(tick, 2000)
}

// ── routes ──────────────────────────────────────────────────────────────────

const ok = (data: unknown, status = 200) => Response.json(data, { status })
const fail = (err: unknown, status?: number) => { const r = errorBody(err, status); return Response.json(r.body, { status: r.status }) }
async function body<T extends Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try { return (await req.json()) as Partial<T> } catch { return {} }
}
const query = (req: Request, k: string) => new URL(req.url).searchParams.get(k)

type Handler = (req: Request, params: string[]) => Promise<Response> | Response
/** [method, path pattern, handler, default status of a failure] — the same table as app/api/**. */
const routes: Array<[string, RegExp, Handler, number?]> = []
const route = (method: string, pattern: RegExp, h: Handler, failStatus?: number) => routes.push([method, pattern, h, failStatus])
const walletsView = () => ({ dir: KEYS_HOME, wallets: ks.list().map(info), mainWallet: ks.main(), archived: ks.archivedCount(), missing: [], pending: ks.pending().map((w) => ({ publicKey: w.publicKey, label: w.label })) })
/** `publicKeys` of a body: the 0x ones, in the keystore's spelling. */
const targetsOf = (v: unknown) => strings(v).filter(isAddress).map(canon)
/** The launch form of a body; plan / fund take it before an image, a name or a symbol exists. */
const formOf = async (req: Request, placeholderImage = false) => {
  const b = await body<launch.LaunchForm>(req)
  return launch.normalizeForm(placeholderImage ? { ...b, name: b.name || "plan", symbol: b.symbol || "PLAN", image: b.image || "https://placeholder.invalid/x" } : b)
}

// wallets
route("GET", /^\/api\/wallets$/, () => ok(walletsView()))
route("POST", /^\/api\/wallets$/, async (req) => {
  const b = await body<{ count: number; role: string; label: string }>(req)
  const wallets = createWallets(Number(b.count) || 1, isRole(b.role) ? b.role : "trader", typeof b.label === "string" ? b.label : undefined)
  return ok({ dir: `${KEYS_HOME}: press Download backup before funding`, wallets, mainWallet: ks.main() })
}, 409)
route("POST", /^\/api\/wallets\/import$/, async (req) => {
  const b = await body<{ privateKey: string; role: string; label: string }>(req)
  if (typeof b.privateKey !== "string" || !b.privateKey.trim()) throw new RouteError("privateKey (0x hex) is required")
  const k = parseSecret(b.privateKey)
  const role: Role = isRole(b.role) ? b.role : "trader"
  const { wallet, existed } = ks.add({ ...k, chain: CHAIN, role, label: (typeof b.label === "string" && b.label.trim()) || `Wallet ${ks.seen() + 1}`, createdAt: new Date().toISOString(), app: APP_NAME })
  return ok({ dir: KEYS_HOME, wallet: { ...info(wallet), path: KEYS_HOME, existed }, mainWallet: ks.main() })
}, 400)
route("POST", /^\/api\/wallets\/main$/, async (req) => {
  const b = await body<{ publicKey: string }>(req)
  if (!isAddress(b.publicKey)) throw new RouteError("publicKey: a 0x address")
  return ok({ mainWallet: info(ks.setMain(canon(b.publicKey))) })
})
route("POST", /^\/api\/wallets\/update$/, async (req) => {
  const b = await body<{ publicKey: string; label: string; role: string }>(req)
  if (!isAddress(b.publicKey)) throw new RouteError("publicKey: a 0x address")
  if (b.role !== undefined && !isRole(b.role)) throw new RouteError("role must be one of funding, bundle, sniper, holder, trader")
  const pk = canon(b.publicKey)
  const w = ks.get(pk)
  if (!w) throw ks.missing(pk)
  return ok({ wallet: info(ks.update(pk, { label: cleanLabel(typeof b.label === "string" ? b.label : undefined, w.label), role: isRole(b.role) ? b.role : undefined })) })
})
route("POST", /^\/api\/wallets\/export$/, async (req) => {
  const targets = targetsOf((await body<{ publicKeys: string[] }>(req)).publicKeys)
  if (!targets.length) throw new RouteError("publicKeys: at least one 0x wallet")
  return ok({ wallets: ks.secrets(targets).map((r) => ({ publicKey: r.publicKey, privateKey: r.privateKey, label: r.label, file: KEYS_HOME })) })
})
route("POST", /^\/api\/wallets\/archive$/, async (req) => {
  const targets = targetsOf((await body<{ publicKeys: string[] }>(req)).publicKeys)
  if (!targets.length) throw new RouteError("publicKeys: at least one 0x wallet")
  return ok({ archived: ks.archive(targets), dir: `${KEYS_HOME} (archived wallets stay in every backup and export)` })
}, 409)
/** Demo only: `Download backup` (the not-yet-backed-up wallets) and `Export all keys` (every wallet). One file per click. */
route("POST", /^\/api\/wallets\/backup$/, () => ok(ks.downloadBackup()))
route("POST", /^\/api\/wallets\/export-all$/, () => ok(ks.exportAll()))
/** Local mode's "Rewrite backups", in the browser: the same download as `Download backup`. */
route("POST", /^\/api\/wallets\/rewrite-backups$/, () => { const r = ks.downloadBackup(); return ok({ dir: KEYS_HOME, files: ks.list().length, restored: [], csvAdded: r.count, downloaded: r.files }) })
route("GET", /^\/api\/wallets\/balances$/, async (req) => {
  const token = query(req, "token")
  const rows = await trading.balanceRows(env(), token && isAddress(token) ? token : null)
  return ok({ token: token ?? null, rows, balances: rows })
})
route("GET", /^\/api\/wallets\/account$/, async (req) => {
  const wallet = query(req, "wallet")
  if (!isAddress(wallet)) throw new RouteError("wallet: a 0x address")
  return ok(await api().rh.account(wallet))
})
route("POST", /^\/api\/wallets\/fund$/, async (req) => {
  const b = await body<{ publicKeys: string[]; amount: number; amountEth: number }>(req)
  const targets = targetsOf(b.publicKeys)
  const amount = num(b.amount ?? b.amountEth, 0)
  if (!targets.length) throw new RouteError("publicKeys: at least one 0x wallet")
  if (!(amount > 0)) throw new RouteError("amount must be greater than zero")
  return ok({ amountEth: amount, ...(await fundDirect(env(), targets.map((publicKey) => ({ publicKey, eth: amount })))) })
})
route("POST", /^\/api\/wallets\/fund-exchange$/, async (req) => {
  const b = await body<{ publicKeys: string[]; amount: number; amountEth: number; mode: TransferMode; venue: string }>(req)
  const targets = targetsOf(b.publicKeys)
  const amount = num(b.amount ?? b.amountEth, 0)
  if (!targets.length) throw new RouteError("publicKeys: at least one 0x wallet")
  if (!(amount > 0)) throw new RouteError("amount must be greater than zero")
  const mode: TransferMode = b.mode === "fixed" || b.mode === "private" ? b.mode : "float"
  return ok(await fundViaExchange(env(), targets.map((publicKey) => ({ publicKey, eth: amount })), mode, typeof b.venue === "string" && b.venue ? b.venue : "random"))
})
route("POST", /^\/api\/wallets\/gather$/, async (req) => {
  const targets = targetsOf((await body<{ publicKeys: string[] }>(req)).publicKeys)
  if (!targets.length) throw new RouteError("publicKeys: at least one 0x wallet")
  return ok(await gather(env(), targets))
})
route("GET", /^\/api\/transfer\/venues$/, async () => ok(await api().transferVenues()))
route("GET", /^\/api\/transfer\/([^/]+)$/, async (_req, [id]) => ok(await api().transferStatus(decodeURIComponent(id))))

// settings: the same shape as GET /api/settings in local mode, plus `demo`, `pending` and `keyError`
async function settingsView() {
  const key = await ensureApiKey(KEY_OPTS)
  const s = settings()
  const a = api()
  let status: "connected" | "no_key" | "error" = "no_key"
  let keyPrefix: string | undefined
  let error: { error: string; code?: string; hint?: string; docs?: string; status?: number } | undefined
  if (key) {
    try {
      const me = await a.me()
      status = "connected"
      keyPrefix = me.keyPrefix
    } catch (e) {
      status = "error"
      error = e instanceof ApiError ? e.toJSON() : { error: e instanceof Error ? e.message : String(e) }
    }
  }
  const main = walletStore.main()
  return {
    apiUrl: DEMO_API_URL, apiKeyMasked: key ? maskKey(key) : "", apiKeyFrom: "browser",
    ...s, backupDir: KEYS_HOME, funding: main, status, keyPrefix, error,
    createKeyUrl: `${DEMO_API_URL}/api/create-api-key?label=${DEMO_KEY_LABEL}`,
    demo: true, pending: ks.pending().length, keyError: key ? null : keyError(),
  }
}
route("GET", /^\/api\/settings$/, async () => ok(await settingsView()))
route("PUT", /^\/api\/settings$/, async (req) => {
  const b = await body<{ apiKey: string | null; createKey: boolean } & { [K in (typeof NUMS)[number]]: number | null }>(req)
  if (b.createKey === true) await replaceApiKey(KEY_OPTS) // the API's refusal (rate_limited, …) is thrown verbatim
  if (b.apiKey !== undefined) setApiKey(KEY_OPTS, typeof b.apiKey === "string" ? b.apiKey : null)
  const cur = load<BrowserSettings>(`${P}.settings`, {})
  for (const k of NUMS) {
    if (b[k] === undefined) continue
    const v = b[k]
    if (okNum(v)) cur[k] = v
    else delete cur[k]
  }
  save(`${P}.settings`, cur)
  return ok(await settingsView())
})

// launch
route("GET", /^\/api\/launch$/, () => ok({ launches: readLaunches() }))
route("POST", /^\/api\/launch$/, async (req) => {
  const form = await formOf(req)
  const rec = launch.newRecord(form)
  saveLaunch(rec) // listed (running) at once, so the log stream finds it
  runInTab(rec, form)
  return ok({ id: rec.id })
})
route("POST", /^\/api\/launch\/plan$/, async (req) => {
  const { resolved, ...plan } = await launch.planWithBalances(env(), await formOf(req, true))
  return ok({ ...plan, dev: resolved.dev.publicKey, exempt: resolved.exempt.length, wallets: { bundle: resolved.bundle, snipers: resolved.snipers, holders: resolved.holders } })
})
route("POST", /^\/api\/launch\/fund$/, async (req) => ok(await launch.fundPlan(env(), await formOf(req, true))))
route("POST", /^\/api\/launch\/simulate$/, async (req) => ok(await launch.simulate(env(), await formOf(req))))
// the image: the visitor's FormData goes straight to POST /api/ipfs with their key; the create takes metadata.image
route("POST", /^\/api\/launch\/image$/, async (req) => {
  const fd = await req.formData()
  const file = fd.get("file")
  if (!(file instanceof File) || !file.size) throw new RouteError("file: a PNG, JPG, GIF or WebP up to 4 MB")
  const r = await api().uploadMetadata(fd)
  const image = r.metadata?.image
  if (!image) throw new RouteError("the API answered without metadata.image", 502)
  return ok({ image, metadataUri: r.metadataUri })
})

// trading
route("GET", /^\/api\/trading\/token$/, async (req) => {
  const token = query(req, "token")
  if (!isAddress(token)) throw new RouteError("token: a 0x address")
  return ok(await api().rh.token(token))
})
route("GET", /^\/api\/trading\/holdings$/, async (req) => {
  const token = query(req, "token")
  if (!isAddress(token)) throw new RouteError("token: a 0x address")
  return ok({ token, creator: trading.creatorOf(env(), token), holdings: await trading.holdings(env(), token) })
})
route("GET", /^\/api\/trading\/quote$/, async (req) => {
  const token = query(req, "token"), wallet = query(req, "wallet") ?? undefined
  const action = query(req, "action") === "sell" ? "sell" : "buy"
  const amount = num(query(req, "amount"), 0)
  if (!isAddress(token)) throw new RouteError("token: a 0x address")
  if (!(amount > 0)) throw new RouteError("amount must be greater than zero")
  return ok(await api().rh.quote({ token, action, amount, wallet: isAddress(wallet) ? wallet : undefined }))
})
route("POST", /^\/api\/trading\/buy$/, async (req) => {
  const b = await body<{ publicKey: string; token: string; amount: number; eth: number }>(req)
  if (!isAddress(b.publicKey) || !isAddress(b.token)) throw new RouteError("publicKey and token: 0x addresses")
  const eth = num(b.amount ?? b.eth, 0)
  if (!(eth > 0)) throw new RouteError("amount must be greater than zero")
  return ok(await trading.buy(env(), canon(b.publicKey), b.token, eth))
})
route("POST", /^\/api\/trading\/sell$/, async (req) => {
  const b = await body<{ publicKey: string; token: string; percent: number }>(req)
  if (!isAddress(b.publicKey) || !isAddress(b.token)) throw new RouteError("publicKey and token: 0x addresses")
  return ok(await trading.sell(env(), canon(b.publicKey), b.token, num(b.percent, 100)))
})
route("POST", /^\/api\/trading\/sell-all$/, async (req) => {
  const b = await body<{ publicKeys: string[]; token: string; percent: number }>(req)
  const wallets = targetsOf(b.publicKeys)
  if (!wallets.length || !isAddress(b.token)) throw new RouteError("publicKeys (0x) and token (0x) are required")
  for (const pk of wallets) walletStore.assertBackedUp(pk)
  return ok({ results: await trading.sellAll(env(), wallets, b.token, num(b.percent, 100)) })
})
route("GET", /^\/api\/trading\/timers$/, (req) => ok({ timers: forToken(readTimers(), query(req, "token")) }))
route("POST", /^\/api\/trading\/timers$/, async (req) => {
  const b = await body<{ token: string; publicKeys: string[]; percent: number; minutes: number }>(req)
  const wallets = targetsOf(b.publicKeys)
  if (!isAddress(b.token) || !wallets.length) throw new RouteError("token (0x) and publicKeys (0x) are required")
  for (const pk of wallets) walletStore.assertBackedUp(pk) // a rule for an unbacked wallet is refused when it is made, not when it fires
  const timer = newTimerRule({ token: b.token, publicKeys: wallets, percent: num(b.percent, 100), minutes: num(b.minutes, 0) })
  saveTimer(timer)
  return ok({ timer })
})
route("DELETE", /^\/api\/trading\/timers$/, (req) => {
  const id = query(req, "id")
  if (!id) {
    const keep = readTimers().filter((r) => !isFinished(r))
    const cleared = readTimers().length - keep.length
    save(`${P}.timers`, keep)
    return ok({ cleared })
  }
  const rule = readTimers().find((r) => r.id === id)
  if (!rule) return fail(new Error("no such timer"), 404)
  if (rule.status === "pending") { rule.status = "cancelled"; saveTimer(rule) }
  return ok({ timer: rule })
})

/** One request → the route's Response (404 for an unknown path, the API's error shape for every failure). */
export async function handle(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname
  for (const [method, pattern, h, failStatus] of routes) {
    if (method !== req.method) continue
    const m = pattern.exec(path)
    if (!m) continue
    try {
      return await h(req, m.slice(1))
    } catch (e) {
      return fail(e, failStatus)
    }
  }
  return fail(new Error(`No route ${req.method} ${path} in the browser engine`), 404)
}

// ── event streams (the server's sse routes) ─────────────────────────────────

/** GET /api/launch/:id/log: the log so far, then every new entry until one says done. */
function launchLog(id: string): EventStream {
  return (send, close) => {
    const history = entriesOf(id)
    for (const e of history) send(e)
    const rec = readLaunches().find((l) => l.id === id)
    if (!rec) { send({ t: Date.now(), stage: "failed", msg: "no such launch in this browser; see the launch records", level: "error", done: true }); close(); return () => {} }
    if (history.some((e) => e.done) || (rec.status !== "running" && !history.length)) {
      if (!history.length) send({ t: Date.now(), stage: rec.status, msg: rec.error ?? `Launch ${rec.status}`, level: rec.status === "failed" ? "error" : "ok", done: true })
      close()
      return () => {}
    }
    return subscribeLaunch(id, (e) => { send(e); if (e.done) close() })
  }
}

/** GET /api/trading/feed?token=0x…: the API websocket (wss://…/api/rh/data?api-key=…) opened from this tab. */
function tradeFeed(token: string): EventStream {
  return (send) => {
    let ws: WebSocket | null = null
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | null = null
    let first = true
    const seen = new Set<string>()
    const connect = () => {
      const a = api()
      if (!a.configured) { retry = setTimeout(connect, 3000); return } // the key is still being created
      ws = new WebSocket(a.wsUrl())
      ws.onopen = () => {
        ws?.send(trading.subscribeMessage(token))
        if (first) { first = false; send({ type: "snapshot", trades: [] }) }
      }
      ws.onmessage = (m) => {
        const t = trading.parseTrade(String(m.data), token, walletStore.list())
        if (!t || seen.has(t.hash)) return
        seen.add(t.hash)
        send({ type: "trade", trade: t })
      }
      ws.onclose = () => { if (!stopped) retry = setTimeout(connect, 3000) }
    }
    connect()
    return () => { stopped = true; if (retry) clearTimeout(retry); try { ws?.close() } catch { /* closing */ } }
  }
}

/** The event stream of a path, or null when it has none. */
export function stream(url: URL): EventStream | null {
  const m = /^\/api\/launch\/([^/]+)\/log$/.exec(url.pathname)
  if (m) return launchLog(decodeURIComponent(m[1]))
  if (url.pathname === "/api/trading/feed") {
    const token = url.searchParams.get("token") || ""
    return isAddress(token) ? tradeFeed(token) : null
  }
  return null
}

// ── start-up: the visitor's key, interrupted launches, timed sells ───────────

if (typeof window !== "undefined") {
  void ensureApiKey(KEY_OPTS)
  void recoverLaunches().catch(() => {})
  void startTimers().catch(() => {})
}
