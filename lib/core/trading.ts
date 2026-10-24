/**
 * Trading after the launch, shared by local mode (lib/trading.ts) and demo mode (lib/browser/engine.ts). Every trade is
 * built by POST /api/rh/trade-local (the API follows the coin from the pons curve to its Uniswap v4 pool), signed with
 * the wallet's key, sent in order with POST /api/rh/send (an `approve` confirms before the sell goes out) and confirmed
 * with GET /api/rh/tx/:hash. Live trades come from the API websocket wss://…/api/rh/data (subscribeTokenTrade): the
 * message shapes are here, the socket itself belongs to each mode. No node imports.
 */
import { sendAll } from "./evm"
import type { Env } from "./env"
import type { Expected } from "../trenchy"
import { same, type WalletInfo } from "./wallet-record"

export type Holding = WalletInfo & { eth: number; tokens: number }

/** Every wallet with its ETH (GET /api/rh/balances?wallets=) and this coin's balance (GET /api/rh/balances?wallet=&tokens=). */
export async function holdings(env: Env, token: string): Promise<Holding[]> {
  const wallets = env.wallets.list()
  if (!wallets.length) return []
  const api = env.api
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

/** ETH (and, with `token`, that coin's balance) per wallet, under the names the shared pages read (`native`). */
export async function balanceRows(env: Env, token?: string | null): Promise<Array<{ publicKey: string; native: number; eth: number; tokens?: number }>> {
  if (token) return (await holdings(env, token)).map((h) => ({ publicKey: h.publicKey, native: h.eth, eth: h.eth, tokens: h.tokens }))
  const wallets = env.wallets.list()
  const eth = wallets.length ? await env.api.rh.ethBalances(wallets.map((w) => w.publicKey)) : new Map<string, number>()
  return wallets.map((w) => ({ publicKey: w.publicKey, native: eth.get(w.publicKey.toLowerCase()) ?? 0, eth: eth.get(w.publicKey.toLowerCase()) ?? 0 }))
}

export type TradeResult = { publicKey: string; hashes: string[]; hash: string; expected: Expected; confirmed: boolean }

/** One wallet sells `percent` of its balance ("NN%" is resolved by the API from the real balance). approve → sell → fee, in order. */
export async function sell(env: Env, publicKey: string, token: string, percent: number, slippage = env.slippage): Promise<TradeResult> {
  const api = env.api
  const pct = Math.max(1, Math.min(100, Math.round(percent)))
  const account = env.wallets.accountOf(publicKey) // the key must be backed up: NotBackedUpError otherwise
  const built = await api.rh.tradeLocal({ wallet: publicKey, action: "sell", token, amount: `${pct}%`, denominatedInEth: "false", slippage })
  let hash = ""
  const hashes = await sendAll(api, account, built.transactions, { confirm: true, onStep: (label, h) => { if (label === "sell") hash = h } })
  return { publicKey, hashes, hash: hash || hashes[0], expected: built.expected, confirmed: true }
}

/** One wallet buys for `eth` ETH. */
export async function buy(env: Env, publicKey: string, token: string, eth: number, slippage = env.slippage): Promise<TradeResult> {
  const api = env.api
  env.wallets.assertBackedUp(publicKey)
  const account = env.wallets.accountOf(publicKey)
  const built = await api.rh.tradeLocal({ wallet: publicKey, action: "buy", token, amount: eth, denominatedInEth: "true", slippage })
  let hash = ""
  const hashes = await sendAll(api, account, built.transactions, { confirm: true, onStep: (label, h) => { if (label === "buy") hash = h } })
  return { publicKey, hashes, hash: hash || hashes[0], expected: built.expected, confirmed: true }
}

export type SellAllResult = Array<TradeResult | { publicKey: string; skipped?: string; error?: string; code?: string }>

/** Sell `percent` from each wallet, one after the other (wallets holding none are skipped). */
export async function sellAll(env: Env, publicKeys: string[], token: string, percent: number): Promise<SellAllResult> {
  const out: SellAllResult = []
  for (const pk of publicKeys) {
    try {
      const bal = await env.api.rh.balances(pk, [token])
      if (!(Number(bal.tokens?.[0]?.balance ?? 0) > 0)) { out.push({ publicKey: pk, skipped: "holds none" }); continue }
      out.push(await sell(env, pk, token, percent))
    } catch (e) {
      out.push({ publicKey: pk, error: e instanceof Error ? e.message : String(e), code: (e as { code?: string })?.code })
    }
  }
  return out
}

/** The creator of a coin we launched (from the launch records), or null. */
export function creatorOf(env: Env<{ token?: string; dev: string }>, token: string): string | null {
  return env.launches.list().find((l) => l.token?.toLowerCase() === token.toLowerCase())?.dev ?? null
}

// ── live trades: wss://…/api/rh/data, subscribeTokenTrade per coin ──────────

export type LiveTrade = { hash: string; token: string; type: "buy" | "sell"; trader: string; eth: number; tokens: number; priceEth: number | null; timestamp: number; ours: string | null; venue: string | null }

export const subscribeMessage = (token: string) => JSON.stringify({ method: "subscribeTokenTrade", keys: [token] })
export const unsubscribeMessage = (token: string) => JSON.stringify({ method: "unsubscribeTokenTrade", keys: [token] })

/** One websocket message → a trade of `token`, or null (another coin, not a trade, not JSON). `wallets` tags our own. */
export function parseTrade(data: string, token: string, wallets: WalletInfo[]): LiveTrade | null {
  try {
    const raw = JSON.parse(data) as Record<string, unknown>
    if ((raw.txType !== "buy" && raw.txType !== "sell") || String(raw.token ?? "").toLowerCase() !== token.toLowerCase()) return null
    const hash = String(raw.hash ?? "")
    if (!hash) return null
    const trader = String(raw.trader ?? "")
    const ours = wallets.find((w) => same(w.publicKey, trader))
    return {
      hash, token, type: raw.txType, trader,
      eth: Number(raw.ethAmount ?? 0), tokens: Number(raw.tokenAmount ?? 0), priceEth: typeof raw.priceEth === "number" ? raw.priceEth : null,
      timestamp: typeof raw.ts === "number" ? raw.ts : Date.now(), ours: ours ? `${ours.label} · ${ours.role}` : null, venue: typeof raw.venue === "string" ? raw.venue : null,
    }
  } catch {
    return null // not a trade
  }
}
