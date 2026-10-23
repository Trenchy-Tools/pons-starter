/**
 * Trading after the launch. Every trade is built by POST /api/rh/trade-local (the API follows the coin from the pons
 * curve to its Uniswap v4 pool), signed with the wallet's key from the folder, sent in order with POST /api/rh/send
 * (an `approve` confirms before the sell goes out) and confirmed with GET /api/rh/tx/:hash. Live trades come from the
 * API websocket wss://…/api/rh/data (subscribeTokenTrade).
 */
import WebSocket from "ws"
import { readLaunches } from "./launch"
import { serverState } from "./paths"
import { effectiveSettings } from "./settings"
import { trenchy, type Expected } from "./trenchy"
import { accountOf, assertBackedUp, listWallets, type WalletInfo } from "./wallets"

export type Holding = WalletInfo & { eth: number; tokens: number }

/** Every wallet in the folder with its ETH (GET /api/rh/balances?wallets=) and this coin's balance (GET /api/rh/balances?wallet=&tokens=). */
export async function holdings(token: string): Promise<Holding[]> {
  const wallets = listWallets()
  if (!wallets.length) return []
  const api = trenchy()
  const eth = await api.rh.ethBalances(wallets.map((w) => w.publicKey))
  const tokens = new Map<string, number>()
  for (let i = 0; i < wallets.length; i += 6) { // six wallets at a time: one call each
    await Promise.all(wallets.slice(i, i + 6).map(async (w) => {
      const r = await api.rh.balances(w.publicKey, [token]).catch(() => null)
      tokens.set(w.publicKey.toLowerCase(), Number(r?.tokens?.[0]?.balance ?? 0))
    }))
  }
  return wallets.map((w) => ({ ...w, eth: eth.get(w.publicKey.toLowerCase()) ?? 0, tokens: tokens.get(w.publicKey.toLowerCase()) ?? 0 }))
}

export type TradeResult = { publicKey: string; hashes: string[]; hash: string; expected: Expected; confirmed: boolean }

/** One wallet sells `percent` of its balance ("NN%" is resolved by the API from the real balance). approve → sell → fee, in order. */
export async function sell(publicKey: string, token: string, percent: number, slippage = effectiveSettings().slippage): Promise<TradeResult> {
  const api = trenchy()
  const pct = Math.max(1, Math.min(100, Math.round(percent)))
  const account = accountOf(publicKey) // the key must be on disk: NotBackedUpError otherwise
  const built = await api.rh.tradeLocal({ wallet: publicKey, action: "sell", token, amount: `${pct}%`, denominatedInEth: "false", slippage })
  let hash = ""
  const hashes = await api.sendAll(account, built.transactions, { confirm: true, onStep: (label, h) => { if (label === "sell") hash = h } })
  return { publicKey, hashes, hash: hash || hashes[0], expected: built.expected, confirmed: true }
}

/** One wallet buys for `eth` ETH. */
export async function buy(publicKey: string, token: string, eth: number, slippage = effectiveSettings().slippage): Promise<TradeResult> {
  const api = trenchy()
  assertBackedUp(publicKey)
  const account = accountOf(publicKey)
  const built = await api.rh.tradeLocal({ wallet: publicKey, action: "buy", token, amount: eth, denominatedInEth: "true", slippage })
  let hash = ""
  const hashes = await api.sendAll(account, built.transactions, { confirm: true, onStep: (label, h) => { if (label === "buy") hash = h } })
  return { publicKey, hashes, hash: hash || hashes[0], expected: built.expected, confirmed: true }
}

export type SellAllResult = Array<TradeResult | { publicKey: string; skipped?: string; error?: string; code?: string }>

/** Sell `percent` from each wallet, one after the other (wallets holding none are skipped). */
export async function sellAll(publicKeys: string[], token: string, percent: number): Promise<SellAllResult> {
  const api = trenchy()
  const out: SellAllResult = []
  for (const pk of publicKeys) {
    try {
      const bal = await api.rh.balances(pk, [token])
      if (!(Number(bal.tokens?.[0]?.balance ?? 0) > 0)) { out.push({ publicKey: pk, skipped: "holds none" }); continue }
      out.push(await sell(pk, token, percent))
    } catch (e) {
      out.push({ publicKey: pk, error: e instanceof Error ? e.message : String(e), code: (e as { code?: string })?.code })
    }
  }
  return out
}

/** The creator of a coin we launched (from launches.json), or null. */
export function creatorOf(token: string): string | null {
  return readLaunches().find((l) => l.token?.toLowerCase() === token.toLowerCase())?.dev ?? null
}

// ── live trades: one websocket to wss://…/api/rh/data, subscribeTokenTrade per coin ─────────────────────────────

export type LiveTrade = { hash: string; token: string; type: "buy" | "sell"; trader: string; eth: number; tokens: number; priceEth: number | null; timestamp: number; ours: string | null; venue: string | null }

type Feed = { ws: WebSocket | null; url: string | null; token: string | null; trades: LiveTrade[]; seen: Set<string>; listeners: Set<(t: LiveTrade) => void> }
const feed = serverState<Feed>("feed", () => ({ ws: null, url: null, token: null, trades: [], seen: new Set(), listeners: new Set() }))

function connect(): void {
  if (!feed.url) return
  const ws = new WebSocket(feed.url)
  feed.ws = ws
  ws.on("open", () => { if (feed.token) ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [feed.token] })) })
  ws.on("message", (data) => {
    try {
      const raw = JSON.parse(data.toString()) as Record<string, unknown>
      if ((raw.txType !== "buy" && raw.txType !== "sell") || String(raw.token ?? "").toLowerCase() !== feed.token?.toLowerCase()) return
      const hash = String(raw.hash ?? "")
      if (!hash || feed.seen.has(hash)) return
      feed.seen.add(hash)
      const trader = String(raw.trader ?? "")
      const ours = listWallets().find((w) => w.publicKey.toLowerCase() === trader.toLowerCase())
      const t: LiveTrade = {
        hash, token: feed.token!, type: raw.txType, trader,
        eth: Number(raw.ethAmount ?? 0), tokens: Number(raw.tokenAmount ?? 0), priceEth: typeof raw.priceEth === "number" ? raw.priceEth : null,
        timestamp: typeof raw.ts === "number" ? raw.ts : Date.now(), ours: ours ? `${ours.label} · ${ours.role}` : null, venue: typeof raw.venue === "string" ? raw.venue : null,
      }
      feed.trades.unshift(t)
      if (feed.trades.length > 200) feed.trades.length = 200
      for (const cb of feed.listeners) cb(t)
    } catch { /* not a trade */ }
  })
  ws.on("close", () => { if (feed.ws === ws && feed.token) setTimeout(connect, 3000) })
  ws.on("error", (e) => console.warn("[feed]", e.message))
}

/** Follow one coin (the previous one is dropped). Returns the trades seen so far. */
export function followToken(token: string): LiveTrade[] {
  const api = trenchy()
  const url = api.configured ? api.wsUrl() : null
  if (url !== feed.url || !feed.ws || feed.ws.readyState > WebSocket.OPEN) {
    feed.url = url
    try { feed.ws?.close() } catch { /* closing */ }
    feed.ws = null
    feed.token = token
    feed.trades = []
    feed.seen = new Set()
    connect()
  } else if (feed.token?.toLowerCase() !== token.toLowerCase()) {
    if (feed.token && feed.ws.readyState === WebSocket.OPEN) feed.ws.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [feed.token] }))
    feed.token = token
    feed.trades = []
    feed.seen = new Set()
    if (feed.ws.readyState === WebSocket.OPEN) feed.ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [token] }))
  }
  return feed.trades
}

export function onTrade(cb: (t: LiveTrade) => void): () => void {
  feed.listeners.add(cb)
  return () => feed.listeners.delete(cb)
}
