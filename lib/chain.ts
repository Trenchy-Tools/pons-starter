/**
 * What differs between the pump.fun starter and the pons starter on the shared pages: the chain's name, its native
 * coin, how addresses look, where things are seen, and which extras exist. Client-safe (no node imports). The pages
 * under app/wallets and app/trading and the components are the same files in both apps; only this one differs.
 */
export type ChainConfig = {
  name: string
  symbol: string
  /** the query / body field a coin travels in on this app's routes */
  coinParam: "mint" | "token"
  coinNoun: string
  keyNoun: string
  isAddress: (s: string) => boolean
  isCoin: (s: string) => boolean
  short: (s: string) => string
  /** a native amount for a table cell */
  fmt: (n: number | null | undefined) => string
  explorerAddress: (address: string) => string
  explorerTx: (sig: string) => string
  coinLinks: (coin: string) => Array<{ label: string; href: string }>
  /** GMGN's embeddable candle chart (gmgn.cc is their widget host; gmgn.ai refuses to be framed), or null when the chain has none */
  chartUrl: (coin: string, theme: "dark" | "light") => string | null
  /** the launch-log stream of this app, and one entry of it read into a common shape (the pump.fun and pons routes differ) */
  launchLog: { path: (id: string) => string; read: (e: Record<string, unknown>) => { stage: string; message: string; done: boolean; error: boolean } }
  /** the "Set every amount to" pills, in the native coin */
  pills: string[]
  /** the default of the "Amount each" input (funding) and of a buy */
  defaultEach: string
  defaultBuy: string
  features: {
    /** Solana: empty token accounts hold rent that "Close empty token accounts" recovers */
    tokenAccounts: boolean
    /** pump.fun pays the creator a share of the trading fees */
    creatorFees: boolean
    /** pump.fun Mayhem coins: a buy past the remaining supply needs `partial fill` */
    mayhem: boolean
  }
}

const ADDR = /^0x[0-9a-fA-F]{40}$/
const BLOCKSCOUT = "https://robinhoodchain.blockscout.com"

export const chain: ChainConfig = {
  name: "Robinhood Chain",
  symbol: "ETH",
  coinParam: "token",
  coinNoun: "token address",
  keyNoun: "0x private key",
  isAddress: (s) => ADDR.test(s.trim()),
  isCoin: (s) => ADDR.test(s.trim()),
  short: (s) => (s.length > 13 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s),
  fmt: (n) => (n === null || n === undefined ? "–" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 5 })),
  explorerAddress: (a) => `${BLOCKSCOUT}/address/${a}`,
  explorerTx: (hash) => `${BLOCKSCOUT}/tx/${hash}`,
  coinLinks: (token) => [
    { label: "pons", href: `https://ponsfamily.com/launchpad/${token}` },
    { label: "gmgn", href: `https://gmgn.ai/robinhood/token/${token}` },
    { label: "blockscout", href: `${BLOCKSCOUT}/token/${token}` },
  ],
  chartUrl: (token, theme) => `https://www.gmgn.cc/kline/robinhood/${token}?theme=${theme}`,
  launchLog: {
    path: (id) => `/api/launch/${id}/log`,
    read: (e) => ({ stage: String(e.stage ?? ""), message: String(e.msg ?? ""), done: e.done === true, error: e.level === "error" }),
  },
  // ETH amounts: a 0.001 ETH buy on Robinhood Chain is the size the pons README starts with
  pills: ["0.001", "0.005", "0.01", "0.05", "0.1"],
  defaultEach: "0.002",
  defaultBuy: "0.001",
  // creator fees: the pons escrow (70 % of curve fee + snipe tax, plus the creator tax), claimed by the dev wallet
  features: { tokenAccounts: false, creatorFees: true, mayhem: false },
}
