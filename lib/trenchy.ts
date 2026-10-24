/**
 * The TrenchyTools API client: the one file that talks to https://api.trenchy.tools.
 *
 * Every method names the endpoint it calls. The API builds the EVM transactions and broadcasts them; this app signs
 * them with viem (lib/core/evm.ts) and never talks to an RPC node or IPFS itself.
 *
 * Client-safe (no node imports): the server libs use it with the key from settings (lib/settings.ts `trenchy()`), the
 * hosted demo uses the same class in the browser with the visitor's own key (lib/browser/engine.ts). The key is injected
 * through the constructor; nothing here reads settings.
 *
 * Copy this file into your own project with lib/core/evm.ts and lib/core/errors.ts. It depends only on viem. Docs for every endpoint:
 * https://api.trenchy.tools/AGENTS.md and https://trenchy.tools/openapi.json
 */
import type { PrivateKeyAccount } from "viem/accounts"
import { sendAll, waitSuccess, type AccountData, type SendOptions, type UnsignedTx } from "./core/evm"
import { ApiError } from "./core/errors"

export { ApiError }

// ── shapes ──────────────────────────────────────────────────────────────────

export type TxLabel = "approve" | "buy" | "sell" | "create" | "graduate" | "fee" | "transfer" | "deposit"
/** One entry of a `trade-local` answer: an unsigned EVM transaction. Send them in order. */
export type EvmTx = { chainId: number; from: string; to: string; data: string; value: string; valueEth?: string; gas?: string; label: TxLabel }
export type Expected = { tokens: number; eth: number }
export type TokenMetadata = { name: string; symbol: string; image: string; description?: string; twitter?: string; telegram?: string; website?: string }
/** The body of POST /api/rh/trade-local. */
export type TradeBody = {
  wallet: string
  action: "buy" | "sell" | "create"
  token?: string
  /** buys: ETH · sells: tokens or "NN%" · create: the dev buy in ETH */
  amount?: number | string
  denominatedInEth?: "true" | "false"
  slippage?: number
  tokenMetadata?: TokenMetadata
  /** create: up to 31 wallets that skip the launch-window snipe tax */
  exemptWallets?: string[]
}
export type Built = { chainId: number; transactions: EvmTx[]; expected: Expected; venue: "curve" | "v4"; predicted?: { token: string; curve: string }; launchFeeEth?: number }
export type TxStatus = { hash: string; status: "success" | "reverted" | "pending_or_unknown"; block?: number; gasUsed?: string }
export type Simulation = { ok: boolean; steps: Array<{ label: string; ok: boolean; gasUsed: string | null; error: string | null }> }
export type Quote = { venue: string; action: "buy" | "sell"; ethIn?: number; tokensOut?: number; tokensIn?: number; ethOut?: number; snipeTaxBps?: number; bondingProgressPct?: number; [k: string]: unknown }
export type TokenInfo = { token: string; name: string; symbol: string; venue: "pons-curve" | "uniswap-v4"; curve: string; graduated: boolean; creator: string; curveState: Record<string, number> | null }

export type TransferMode = "float" | "fixed" | "private"
export type TransferVenues = { exchange: "on" | "off" | "degraded"; checkedAt: string | null; venues: Record<string, { status: "open" | "closed" | "unknown"; reason?: string; default?: boolean }>; note?: string }
/** The deposit of a transfer leg: on Robinhood chain it is `evm` `{ chainId, from, to, value, gas }`, a plain transfer to sign. */
export type DepositTx = { chain: string; encoding: "base64" | "evm"; transaction?: string; evm?: { chainId: number; from: string; to: string; value: string; gas: string; data: "0x"; label: "deposit" } }
export type TransferCreated = {
  transferId: string; status: string; route: "direct" | "exchange"; mode?: TransferMode; venue?: string; venueRequested?: string; venueHonoured?: boolean
  from: { chain: string; wallet: string }; to: { chain: string; address: string }; amount: number; expected?: { receive: number; fee: number; etaS: number }
  deposit: { chain: string; address: string; amount: number; deadline?: string } | null
  transaction?: DepositTx; poll?: string; warning?: string
}
export type TransferLegError = { error: string; code: string; leg: { to: { address: string }; amount: number } }
export type TransferBatch = { batchId: string; legs: Array<TransferCreated | TransferLegError>; venues: string[] }
export const isLegError = (l: TransferCreated | TransferLegError): l is TransferLegError => "error" in l
export type TransferStatus = {
  transferId: string; status: string; route: "direct" | "exchange"; mode: TransferMode | null; venue: string | null
  from: { chain: string; wallet: string }; to: { chain: string; address: string }; amount: number; expectedReceive: number | null
  depositHash: string | null; payoutHash: string | null; reason?: string; receipt?: string; help?: Record<string, unknown>; createdAt: number; updatedAt: number
}
/** Statuses after which a transfer will not change any more ("sent" is final for direct transfers only). */
export const transferDone = (t: { status: string; route: string }) =>
  ["completed", "failed", "expired", "refunded", "cancelled"].includes(t.status) || (t.route === "direct" && t.status === "sent")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class Trenchy {
  constructor(public readonly url: string, private readonly key: string) {}

  get configured(): boolean {
    return !!this.key
  }

  /** The websocket for live data (one connection, many subscriptions): wss://…/api/rh/data?api-key=… */
  wsUrl(): string {
    return `${this.url.replace(/^http/, "ws")}/api/rh/data?api-key=${encodeURIComponent(this.key)}`
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.key) throw new ApiError(`No TrenchyTools API key. Create one at ${this.url}/api/create-api-key?label=pons-starter and paste it in Settings.`, 401, "no_key")
    const headers = new Headers(init.headers)
    headers.set("x-api-key", this.key)
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await fetch(`${this.url}${path}`, { ...init, headers, signal: AbortSignal.timeout(45_000) })
      } catch (e) {
        if (attempt < 2) { await sleep(500 * (attempt + 1)); continue }
        throw new ApiError(`TrenchyTools API unreachable at ${this.url} (${e instanceof Error ? e.message : e})`, 0, "unreachable")
      }
      // 429 carries retry-after: wait as the API says, a few times, rather than failing a launch midway.
      if (res.status === 429 && attempt < 4) { await sleep((Number(res.headers.get("retry-after")) || 1) * 1000); continue }
      const text = await res.text()
      let body: Record<string, unknown> | null = null
      try { body = JSON.parse(text) } catch { /* not JSON */ }
      if (!res.ok) throw new ApiError(String(body?.error ?? `TrenchyTools API ${res.status}`), res.status, body?.code as string, body?.hint as string, body?.docs as string)
      return body as T
    }
  }
  private get<T>(path: string) { return this.call<T>(path) }
  private post<T>(path: string, body: unknown) {
    return this.call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  }

  // ── account ──────────────────────────────────────────────────────────────

  /** GET /api/me: the key's prefix and 30-day usage. The "Connected" check. */
  me() { return this.get<{ keyPrefix?: string; usage30d?: unknown[] }>("/api/me") }

  // ── Robinhood chain: /api/rh ─────────────────────────────────────────────

  rh = {
    /** GET /api/rh/account?wallet=0x…: chainId, pendingNonce, maxFeePerGas, maxPriorityFeePerGas, balanceEth. Read it once per wallet per batch. */
    account: (wallet: string) => this.get<AccountData>(`/api/rh/account?wallet=${wallet}`),

    /** POST /api/rh/trade-local: the ordered unsigned transactions for a buy, sell or create ([approve?] trade [fee]; create → + predicted.token). */
    tradeLocal: (b: TradeBody) => this.post<Built>("/api/rh/trade-local", b),

    /** POST /api/rh/simulate { transactions }: run trade-local transactions in order on a copy of the chain. Nothing is sent. */
    simulate: (transactions: EvmTx[]) => this.post<Simulation>("/api/rh/simulate", { transactions }),

    /** POST /api/rh/send { transaction: "0x…signed" } → { hash }. */
    send: (transaction: string) => this.post<{ hash: string }>("/api/rh/send", { transaction }),

    /** GET /api/rh/tx/:hash → { status: "success" | "reverted" | "pending_or_unknown" }. */
    tx: (hash: string) => this.get<TxStatus>(`/api/rh/tx/${hash}`),

    /** GET /api/rh/quote?token&action&amount[&wallet]: the exact numbers before a trade (snipe tax depends on the wallet). */
    quote: (p: { token: string; action: "buy" | "sell"; amount: number; wallet?: string }) =>
      this.get<Quote>(`/api/rh/quote?token=${p.token}&action=${p.action}&amount=${p.amount}${p.wallet ? `&wallet=${p.wallet}` : ""}`),

    /** GET /api/rh/token/:token: name, symbol, venue (pons-curve | uniswap-v4), curve state. */
    token: (token: string) => this.get<TokenInfo>(`/api/rh/token/${token}`),

    /** GET /api/rh/balances?wallets=a,b,…: ETH for up to 100 wallets per call. */
    ethBalances: async (wallets: string[]): Promise<Map<string, number>> => {
      const out = new Map<string, number>()
      for (let i = 0; i < wallets.length; i += 100) {
        const r = await this.get<{ wallets: Array<{ wallet: string; eth: string }> }>(`/api/rh/balances?wallets=${wallets.slice(i, i + 100).join(",")}`)
        for (const w of r.wallets) out.set(w.wallet.toLowerCase(), Number(w.eth))
      }
      return out
    },

    /** GET /api/rh/balances?wallet=&tokens=: ETH + token balances of one wallet. */
    balances: (wallet: string, tokens: string[]) =>
      this.get<{ wallet: string; eth: string; tokens: Array<{ token: string; balance: string }> }>(`/api/rh/balances?wallet=${wallet}${tokens.length ? `&tokens=${tokens.join(",")}` : ""}`),
  }

  /** Poll GET /api/rh/tx/:hash until success (true), reverted (throws) or timed out (false). (lib/core/evm.ts waitSuccess) */
  waitSuccess(hash: string, timeoutMs = 60_000, onProgress?: (msg: string) => void): Promise<boolean> {
    return waitSuccess(this, hash, timeoutMs, onProgress)
  }

  /**
   * Sign and send a run of transactions for one wallet, in order: GET /api/rh/account once, nonce + 1 per
   * transaction, POST /api/rh/send each. An `approve` or `graduate` is confirmed (GET /api/rh/tx) before the next one
   * goes out; the last trade is confirmed when `confirm` is true. Returns every hash, in order. (lib/core/evm.ts sendAll)
   */
  sendAll(account: PrivateKeyAccount, txs: UnsignedTx[], opts: SendOptions = {}): Promise<string[]> {
    return sendAll(this, account, txs, opts)
  }

  // ── transfers (wallet → wallet, direct or through an exchange hop) ──────

  /** GET /api/transfer/venues: which exchange venues are open right now. */
  transferVenues() { return this.get<TransferVenues>("/api/transfer/venues") }
  /** POST /api/transfer/batch: one source → many destinations (or many → one); one order + unsigned deposit per leg (≤ 25 legs). */
  createTransferBatch(body: { from: { chain: "rh"; wallet: string }; to: Array<{ chain: "rh"; address: string; amount: number }>; mode?: TransferMode; venue?: string }) {
    return this.post<TransferBatch>("/api/transfer/batch", body)
  }
  /** GET /api/transfer/:id: awaiting_deposit → exchanging → completed (payoutHash), or a terminal failure with `help`. */
  transferStatus(id: string) { return this.get<TransferStatus>(`/api/transfer/${encodeURIComponent(id)}`) }
  /** POST /api/transfer/:id/sent: record the hash of the deposit you sent. */
  transferSent(id: string, hash: string) { return this.post<{ ok: boolean }>(`/api/transfer/${encodeURIComponent(id)}/sent`, { hash }) }

  /** The EVM deposit of a transfer leg as an UnsignedTx; checked to be a plain transfer from our wallet to the deposit address for the agreed amount. */
  static depositTx(leg: TransferCreated, from: string): UnsignedTx {
    const d = leg.transaction?.evm
    if (!leg.transaction || leg.transaction.encoding !== "evm" || !d) throw new Error("transfer leg carries no EVM deposit transaction")
    if (d.from.toLowerCase() !== from.toLowerCase()) throw new Error("deposit transaction is not paid by our wallet")
    if (d.data !== "0x") throw new Error("deposit transaction is not a plain transfer")
    if (!leg.deposit || d.to.toLowerCase() !== leg.deposit.address.toLowerCase()) throw new Error("deposit transaction does not send to this transfer's deposit address")
    return { label: "deposit", to: d.to, data: "0x", value: d.value, gas: d.gas, chainId: d.chainId }
  }

  // ── metadata ────────────────────────────────────────────────────────────

  /** POST /api/ipfs (multipart): pin the image + metadata. Robinhood creates use `metadata.image`. Pass the browser's FormData straight through. */
  async uploadMetadata(form: FormData): Promise<{ metadataUri: string; metadata?: { image?: string; [k: string]: unknown } }> {
    return this.call("/api/ipfs", { method: "POST", body: form })
  }
}
