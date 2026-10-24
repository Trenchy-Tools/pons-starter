/**
 * Trading after the launch, in local mode: the flows in lib/core/trading.ts run on the wallet folder (lib/env.ts).
 * Live trades come from the API websocket wss://…/api/rh/data (subscribeTokenTrade), held in server memory and
 * relayed to the page as server-sent events.
 */
import WebSocket from "ws"
import * as core from "./core/trading"
import { serverEnv } from "./env"
import { serverState } from "./paths"
import { trenchy } from "./settings"
import { listWallets } from "./wallets"
import type { LiveTrade, SellAllResult, TradeResult } from "./core/trading"

export type { Holding, LiveTrade, SellAllResult, TradeResult } from "./core/trading"

export const holdings = (token: string) => core.holdings(serverEnv(), token)
export const balanceRows = (token?: string | null) => core.balanceRows(serverEnv(), token)
export const sell = (publicKey: string, token: string, percent: number, slippage?: number): Promise<TradeResult> => core.sell(serverEnv(), publicKey, token, percent, slippage)
export const buy = (publicKey: string, token: string, eth: number, slippage?: number): Promise<TradeResult> => core.buy(serverEnv(), publicKey, token, eth, slippage)
export const sellAll = (publicKeys: string[], token: string, percent: number): Promise<SellAllResult> => core.sellAll(serverEnv(), publicKeys, token, percent)
export const creatorOf = (token: string) => core.creatorOf(serverEnv(), token)

// ── live trades: one websocket to wss://…/api/rh/data, subscribeTokenTrade per coin ─────────────────────────────

type Feed = { ws: WebSocket | null; url: string | null; token: string | null; trades: LiveTrade[]; seen: Set<string>; listeners: Set<(t: LiveTrade) => void> }
const feed = serverState<Feed>("feed", () => ({ ws: null, url: null, token: null, trades: [], seen: new Set(), listeners: new Set() }))

function connect(): void {
  if (!feed.url) return
  const ws = new WebSocket(feed.url)
  feed.ws = ws
  ws.on("open", () => { if (feed.token) ws.send(core.subscribeMessage(feed.token)) })
  ws.on("message", (data) => {
    if (!feed.token) return
    const t = core.parseTrade(data.toString(), feed.token, listWallets())
    if (!t || feed.seen.has(t.hash)) return
    feed.seen.add(t.hash)
    feed.trades.unshift(t)
    if (feed.trades.length > 200) feed.trades.length = 200
    for (const cb of feed.listeners) cb(t)
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
    if (feed.token && feed.ws.readyState === WebSocket.OPEN) feed.ws.send(core.unsubscribeMessage(feed.token))
    feed.token = token
    feed.trades = []
    feed.seen = new Set()
    if (feed.ws.readyState === WebSocket.OPEN) feed.ws.send(core.subscribeMessage(token))
  }
  return feed.trades
}

export function onTrade(cb: (t: LiveTrade) => void): () => void {
  feed.listeners.add(cb)
  return () => feed.listeners.delete(cb)
}
