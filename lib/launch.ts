/**
 * The launch executor for pons. One create transaction, then buys in three groups.
 *
 *   1. POST /api/rh/trade-local { wallet: dev, action: "create", tokenMetadata, amount, exemptWallets, slippage }
 *      → transactions[] (create + fee) + predicted.token. Every buyer wallet is on exemptWallets (≤ 31): pons taxes
 *      buys in the launch window unless the wallet is on the creator's list.
 *   2. Sign in order with the dev wallet's account data (GET /api/rh/account), POST /api/rh/send each, then poll
 *      GET /api/rh/tx/:hash until the create says success.
 *   3. The moment it does: every bundle wallet's buy at once (POST /api/rh/trade-local { action: "buy", token:
 *      predicted.token, amount } per wallet, sign, send, confirm). There are no Jito bundles here; the chain has a
 *      sequencer and no public mempool.
 *   4. Snipers: the same, staggered `sniperGapMs`. Holders: spread over `holderWindowS` with jitter, after `holderDelayS`.
 *
 * Progress goes to an in-memory log the route streams as server-sent events; the result lands in
 * `_app/pons-starter/launches.json`.
 */
import { LAUNCHES_FILE, readJson, serverState, writeJson } from "./paths"
import { AppError } from "./http"
import { fundDirect, type FundResult } from "./funding"
import { ponsToken, txLink } from "./links"
import { effectiveSettings } from "./settings"
import { trenchy, type Built, type EvmTx, type Simulation, type TokenMetadata } from "./trenchy"
import { accountOf, assertBackedUp, getWallet, mainWallet, pickOrCreate, type WalletInfo } from "./wallets"

export const API_FEE_PCT = 0.005 // the API's 0.5 % fee rides as a separate `fee` transaction
export const GAS_RESERVE_ETH = 0.0005 // enough for a buy (or create) + fee transfer at today's prices
export const LAUNCH_FEE_ETH = 0.0005 // pons takes it inside the create transaction (the API answers `launchFeeEth`)
export const MAX_EXEMPT = 31
export const MAX_BUNDLE = 16

/** One picked buyer: a wallet of the folder and its buy in ETH. */
export type Buyer = { publicKey: string; amount: number }
/**
 * A buyer group: an explicit list of wallets with their own amounts (the Launch page's "Pick buyers"), or the old
 * `count × eth` (wallets picked by role, missing ones created). `wallets` wins when it has entries.
 */
export type BuyerGroup = { count: number; eth: number; wallets?: Buyer[] }
export type LaunchForm = {
  name: string; symbol: string; description?: string; image: string; twitter?: string; telegram?: string; website?: string
  /** the creator; the ★ wallet when empty */
  devWallet?: string
  devBuyEth: number
  bundle: BuyerGroup; snipers: BuyerGroup; holders: BuyerGroup
  slippage?: number
}

/** A buyer with its wallet record. */
export type Picked = WalletInfo & { amount: number }
export type Resolved = { dev: WalletInfo; bundle: Picked[]; snipers: Picked[]; holders: Picked[]; exempt: string[]; warnings: string[] }

const isAddr = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)
const group = (g: Partial<BuyerGroup> | undefined, max = 500): BuyerGroup => {
  const wallets: Buyer[] = []
  if (Array.isArray(g?.wallets)) {
    for (const x of g.wallets as Array<Partial<Buyer>>) {
      if (!isAddr(x?.publicKey) || wallets.some((b) => b.publicKey.toLowerCase() === x.publicKey!.toLowerCase())) continue
      wallets.push({ publicKey: x.publicKey, amount: Math.max(Number(x.amount) || 0, 0) })
    }
  }
  if (wallets.length > max) throw new AppError(`at most ${max} wallets in this group`, "bad_request", 400)
  return { count: wallets.length || Math.min(Math.max(Math.floor(Number(g?.count) || 0), 0), max), eth: Math.max(Number(g?.eth) || 0, 0), ...(wallets.length ? { wallets } : {}) }
}
/** How many buyers a group has, whichever shape it uses. */
export const groupSize = (g: BuyerGroup): number => g.wallets?.length ?? g.count

/** Validate the form and fill the defaults. */
export function normalizeForm(f: Partial<LaunchForm>): LaunchForm {
  const name = String(f.name ?? "").trim(), symbol = String(f.symbol ?? "").trim(), image = String(f.image ?? "").trim()
  if (!name || !symbol) throw new AppError("name and symbol are required", "bad_request", 400)
  if (!/^(https?:\/\/|ipfs:\/\/)/.test(image)) throw new AppError("image must be an https:// or ipfs:// link: upload one first (POST /api/ipfs answers metadata.image)", "bad_request", 400)
  const devBuyEth = Math.max(Number(f.devBuyEth) || 0, 0)
  if (devBuyEth > 0 && devBuyEth < 0.0001) throw new AppError("the dev buy minimum on pons is 0.0001 ETH", "bad_request", 400)
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
  return { name, symbol, image, description: str(f.description), twitter: str(f.twitter), telegram: str(f.telegram), website: str(f.website), devWallet: str(f.devWallet), devBuyEth, bundle: group(f.bundle, MAX_BUNDLE), snipers: group(f.snipers), holders: group(f.holders), slippage: Number(f.slippage) || undefined }
}

export const metadataOf = (f: LaunchForm): TokenMetadata => ({ name: f.name, symbol: f.symbol, image: f.image, description: f.description, twitter: f.twitter, telegram: f.telegram, website: f.website })

/** The buyers of a group with their amounts: the explicit list (every wallet must be in the folder), or `count` wallets of the role, created (and backed up) when too few exist. */
function pick(role: "bundle" | "sniper" | "holder", g: BuyerGroup): Picked[] {
  if (g.wallets?.length) {
    return g.wallets.map((b) => {
      const w = getWallet(b.publicKey)
      if (!w) throw new AppError(`No wallet ${b.publicKey} in the folder (archived, or never created here)`, "not_backed_up", 409, "Pick wallets from the list on the Launch page")
      return { ...w, amount: b.amount }
    })
  }
  return pickOrCreate(role, g.count, role).map((w) => ({ ...w, amount: g.eth }))
}

/** "0.001 ETH each", or the range when the picked amounts differ. */
const amounts = (ws: Picked[]): string => {
  const xs = ws.map((w) => w.amount)
  const lo = Math.min(...xs), hi = Math.max(...xs)
  return lo === hi ? `${lo} ETH each` : `${lo}–${hi} ETH`
}

/** The wallets a launch uses: the explicit buyers, or (old form shape) wallets by role, created on the spot when a role has too few. */
export function resolveWallets(f: LaunchForm): Resolved {
  const dev = f.devWallet ? getWallet(f.devWallet) : mainWallet()
  if (!dev) throw new AppError(f.devWallet ? `No wallet ${f.devWallet} in the folder` : "No ★ wallet yet: create or import one on the Wallets page", "no_funding_wallet", 400)
  const bundle = pick("bundle", f.bundle)
  const snipers = pick("sniper", f.snipers)
  const holders = pick("holder", f.holders)
  const buyers = [...bundle, ...snipers, ...holders].map((w) => w.publicKey).filter((pk) => pk.toLowerCase() !== dev.publicKey.toLowerCase())
  const warnings: string[] = []
  if (buyers.length > MAX_EXEMPT) warnings.push(`${buyers.length} buyer wallets, but pons exempts at most ${MAX_EXEMPT} from the launch-window snipe tax: the last ${buyers.length - MAX_EXEMPT} will pay it.`)
  return { dev, bundle, snipers, holders, exempt: buyers.slice(0, MAX_EXEMPT), warnings }
}

export type PlanRow = { publicKey: string; label: string; role: string; buyEth: number; needEth: number; haveEth?: number; shortEth?: number }
export type Plan = { rows: PlanRow[]; totalEth: number; shortEth?: number; warnings: string[] }

/** Per buy: ETH + 0.5 % fee + gas reserve; the dev adds the pons launch fee. */
export function fundingPlan(f: LaunchForm, r: Resolved): Plan {
  const need = (eth: number) => eth + eth * API_FEE_PCT + GAS_RESERVE_ETH
  const rows: PlanRow[] = [{ publicKey: r.dev.publicKey, label: r.dev.label, role: "dev", buyEth: f.devBuyEth, needEth: need(f.devBuyEth) + LAUNCH_FEE_ETH }]
  for (const [role, ws] of [["bundle", r.bundle], ["sniper", r.snipers], ["holder", r.holders]] as const) for (const w of ws) rows.push({ publicKey: w.publicKey, label: w.label, role, buyEth: w.amount, needEth: need(w.amount) })
  return { rows, totalEth: rows.reduce((a, x) => a + x.needEth, 0), warnings: r.warnings }
}

/** The plan with live balances (GET /api/rh/balances?wallets=) and the shortfall per wallet. */
export async function planWithBalances(f: LaunchForm): Promise<Plan & { resolved: Resolved }> {
  const r = resolveWallets(f)
  const plan = fundingPlan(f, r)
  const have = await trenchy().rh.ethBalances(plan.rows.map((x) => x.publicKey))
  for (const row of plan.rows) {
    row.haveEth = have.get(row.publicKey.toLowerCase()) ?? 0
    row.shortEth = Math.max(0, row.needEth - row.haveEth)
  }
  plan.shortEth = plan.rows.reduce((a, x) => a + (x.shortEth ?? 0), 0)
  return { ...plan, resolved: r }
}

/** Top every short wallet up from the ★ wallet (direct transfers). The dev wallet is skipped when it is the ★ wallet itself. */
export async function fundPlan(f: LaunchForm): Promise<{ from: string; results: FundResult[] }> {
  const plan = await planWithBalances(f)
  const funding = mainWallet()
  const targets = plan.rows.filter((x) => (x.shortEth ?? 0) > 0 && x.publicKey.toLowerCase() !== funding?.publicKey.toLowerCase()).map((x) => ({ publicKey: x.publicKey, eth: +(x.shortEth ?? 0).toFixed(8) }))
  if (!targets.length) return { from: funding?.publicKey ?? "", results: [] }
  return fundDirect(targets)
}

/** Refuse before anything is built when the dev wallet cannot pay for the create. */
async function checkDevBalance(f: LaunchForm, r: Resolved): Promise<void> {
  const row = fundingPlan(f, r).rows[0]
  const acct = await trenchy().rh.account(r.dev.publicKey) // GET /api/rh/account: balanceEth
  if (Number(acct.balanceEth) < row.needEth) throw new AppError(`Dev wallet ${r.dev.publicKey} holds ${acct.balanceEth} ETH; the create needs about ${row.needEth.toFixed(5)} ETH (dev buy + pons launch fee + API fee + gas). Nothing was sent.`, "insufficient_funds", 409, "Fund it from the ★ wallet (Funding plan → Fund) or send ETH to it")
}

/** Build the create (POST /api/rh/trade-local) and run it through POST /api/rh/simulate. Nothing is sent. */
export async function simulate(f: LaunchForm): Promise<{ predicted?: Built["predicted"]; launchFeeEth?: number; expected: Built["expected"]; simulation: Simulation; exempt: number; warnings: string[] }> {
  const r = resolveWallets(f)
  assertBackedUp(r.dev.publicKey)
  await checkDevBalance(f, r)
  const api = trenchy()
  const built = await api.rh.tradeLocal({ wallet: r.dev.publicKey, action: "create", tokenMetadata: metadataOf(f), amount: f.devBuyEth, exemptWallets: r.exempt, slippage: f.slippage ?? effectiveSettings().slippage })
  const simulation = await api.rh.simulate(built.transactions)
  return { predicted: built.predicted, launchFeeEth: built.launchFeeEth, expected: built.expected, simulation, exempt: r.exempt.length, warnings: r.warnings }
}

// ── the run ──────────────────────────────────────────────────────────────────

export type LogEntry = { t: number; stage: string; msg: string; hash?: string; link?: string; level?: "info" | "ok" | "warn" | "error"; done?: boolean }
export type LaunchRecord = {
  id: string; createdAt: string; status: "running" | "done" | "failed"; name: string; symbol: string; image: string
  token?: string; curve?: string; dev: string; wallets: { bundle: string[]; snipers: string[]; holders: string[] }
  hashes: { create?: string; buys: Array<{ publicKey: string; role: string; hash?: string; error?: string }> }
  links?: { pons: string; blockscout?: string }
  error?: string
}

type Run = { record: LaunchRecord; log: LogEntry[]; listeners: Set<(e: LogEntry) => void> }
const runs = serverState("launches", () => new Map<string, Run>())

export const readLaunches = (): LaunchRecord[] => readJson<LaunchRecord[]>(LAUNCHES_FILE, [])
function saveRecord(rec: LaunchRecord): void {
  const all = readLaunches().filter((l) => l.id !== rec.id)
  all.unshift(rec)
  writeJson(LAUNCHES_FILE, all.slice(0, 200))
}

export const getRun = (id: string): Run | undefined => runs.get(id)
export function onLog(id: string, cb: (e: LogEntry) => void): () => void {
  const run = runs.get(id)
  if (!run) return () => {}
  run.listeners.add(cb)
  return () => run.listeners.delete(cb)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Start a launch; returns its id at once. Follow it with onLog / the SSE route. */
export function startLaunch(f: LaunchForm): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const record: LaunchRecord = { id, createdAt: new Date().toISOString(), status: "running", name: f.name, symbol: f.symbol, image: f.image, dev: "", wallets: { bundle: [], snipers: [], holders: [] }, hashes: { buys: [] } }
  const run: Run = { record, log: [], listeners: new Set() }
  runs.set(id, run)
  void execute(run, f)
  return id
}

async function execute(run: Run, f: LaunchForm): Promise<void> {
  const { record } = run
  const log = (stage: string, msg: string, extra: Partial<LogEntry> = {}) => {
    const e: LogEntry = { t: Date.now(), stage, msg, ...extra }
    run.log.push(e)
    for (const cb of run.listeners) cb(e)
  }
  const api = trenchy()
  const s = effectiveSettings()
  const slippage = f.slippage ?? s.slippage
  try {
    // 1. wallets: all on disk, all exempt from the snipe tax (≤ 31)
    const r = resolveWallets(f)
    for (const w of [r.dev, ...r.bundle, ...r.snipers, ...r.holders]) assertBackedUp(w.publicKey)
    record.dev = r.dev.publicKey
    record.wallets = { bundle: r.bundle.map((w) => w.publicKey), snipers: r.snipers.map((w) => w.publicKey), holders: r.holders.map((w) => w.publicKey) }
    saveRecord(record)
    log("prepare", `Dev ${r.dev.publicKey} · ${r.bundle.length} bundle · ${r.snipers.length} snipers · ${r.holders.length} holders · ${r.exempt.length} wallets on the exempt list`)
    for (const w of r.warnings) log("prepare", w, { level: "warn" })

    // 2. balances: refuse before anything is built
    const plan = await planWithBalances(f)
    const short = plan.rows.filter((x) => (x.shortEth ?? 0) > 0)
    if (short.length) throw new AppError(`${short.length} wallet(s) are short of ETH (total ${plan.shortEth?.toFixed(5)} ETH): ${short.map((x) => `${x.label} needs ${x.needEth.toFixed(5)}, has ${(x.haveEth ?? 0).toFixed(5)}`).join("; ")}. Nothing was sent.`, "insufficient_funds", 409, "Use the Funding plan → Fund button, then launch again")
    log("prepare", "Every wallet holds what the plan asks for", { level: "ok" })

    // 3. the create: POST /api/rh/trade-local { action: "create" } → create + fee, predicted.token
    const built = await api.rh.tradeLocal({ wallet: r.dev.publicKey, action: "create", tokenMetadata: metadataOf(f), amount: f.devBuyEth, exemptWallets: r.exempt, slippage })
    const token = built.predicted?.token
    if (!token) throw new Error("the API did not return predicted.token for the create")
    record.token = token
    record.curve = built.predicted?.curve
    record.links = { pons: ponsToken(token) }
    log("create", `Coin will be ${token} (pons launch fee ${built.launchFeeEth ?? LAUNCH_FEE_ETH} ETH, dev gets about ${Math.round(built.expected.tokens).toLocaleString()} tokens)`, { link: ponsToken(token) })

    // sign + send in order with the dev wallet (GET /api/rh/account once, nonce + 1 per transaction); wait for the create
    const devAccount = accountOf(r.dev.publicKey)
    const hashes = await api.sendAll(devAccount, built.transactions, { confirm: false, onStep: (label, hash) => log("create", `${label} sent`, { hash, link: txLink(hash) }) })
    const createHash = hashes[built.transactions.findIndex((t) => t.label === "create")] ?? hashes[0]
    record.hashes.create = createHash
    saveRecord(record)
    if (!(await api.waitSuccess(createHash, 120_000, (m) => log("create", m)))) throw new Error(`create ${createHash} not confirmed in 2 minutes; check ${txLink(createHash)} before launching again`)
    log("create", `Create confirmed`, { hash: createHash, link: txLink(createHash), level: "ok" })

    // 4. buys. One function for every group: trade-local buy → sign → send → confirm, logged per wallet. Each buyer carries its own amount.
    const buy = async (w: Picked, stage: string): Promise<void> => {
      const row: LaunchRecord["hashes"]["buys"][number] = { publicKey: w.publicKey, role: stage }
      record.hashes.buys.push(row)
      try {
        const b = await api.rh.tradeLocal({ wallet: w.publicKey, action: "buy", token, amount: w.amount, denominatedInEth: "true", slippage })
        const hs = await api.sendAll(accountOf(w.publicKey), b.transactions, { confirm: true, onStep: (label, hash) => { if (label === "buy") row.hash = hash } })
        row.hash = row.hash ?? hs[0]
        log(stage, `${w.label} bought ${w.amount} ETH → ~${Math.round(b.expected.tokens).toLocaleString()} tokens`, { hash: row.hash, link: txLink(row.hash), level: "ok" })
      } catch (e) {
        row.error = e instanceof Error ? e.message : String(e)
        log(stage, `${w.label}: ${row.error}`, { level: "error" })
      }
    }

    const jobs: Promise<void>[] = []
    // bundle: all at once, the moment the create is confirmed
    if (r.bundle.length) log("bundle", `${r.bundle.length} bundle buys of ${amounts(r.bundle)}, all at once`)
    for (const w of r.bundle) jobs.push(buy(w, "bundle"))
    // snipers: staggered sniperGapMs
    if (r.snipers.length) log("snipers", `${r.snipers.length} sniper buys of ${amounts(r.snipers)}, every ${s.sniperGapMs} ms`)
    r.snipers.forEach((w, i) => jobs.push(sleep(s.sniperGapMs * (i + 1)).then(() => buy(w, "snipers"))))
    // holders: after holderDelayS, spread over holderWindowS with jitter
    if (r.holders.length) log("holders", `${r.holders.length} holder buys of ${amounts(r.holders)} over ${s.holderWindowS}s, starting in ${s.holderDelayS}s`)
    r.holders.forEach((w, i) => {
      const at = s.holderDelayS * 1000 + ((i + Math.random()) / r.holders.length) * s.holderWindowS * 1000
      jobs.push(sleep(at).then(() => buy(w, "holders")))
    })
    await Promise.all(jobs)

    const failed = record.hashes.buys.filter((b) => b.error).length
    record.status = "done"
    saveRecord(record)
    log("done", `Launch finished: ${record.hashes.buys.length - failed}/${record.hashes.buys.length} buys landed · ${ponsToken(token)}`, { level: failed ? "warn" : "ok", link: ponsToken(token), done: true })
  } catch (e) {
    record.status = "failed"
    record.error = e instanceof Error ? e.message : String(e)
    saveRecord(record)
    const code = (e as { code?: string })?.code
    log("failed", `${record.error}${code ? ` · ${code}` : ""}`, { level: "error", done: true })
  }
}

/** The transactions of a create, for the UI's "what will be sent" preview (same call as the launch). */
export type CreatePreview = { transactions: EvmTx[]; predicted?: Built["predicted"] }
