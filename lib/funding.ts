/**
 * Moving ETH between the folder's wallets. Three ways, all refusing a wallet whose file is missing (assertBackedUp):
 *
 *   fundDirect      funding wallet → each wallet, a plain `{ to, value, gas: 21000 }` signed with the funding wallet's
 *                   account data (GET /api/rh/account once, nonce + 1 per transfer) and sent with POST /api/rh/send
 *   fundViaExchange POST /api/transfer/batch from the funding wallet (from.chain "rh"): one exchange order per wallet;
 *                   each leg's EVM deposit is signed and sent the same way, then POST /api/transfer/:id/sent
 *   gather          each wallet → funding wallet: balance minus a gas reserve, one transfer per wallet
 */
import { toEth, toWei, transferGasEth, transferTx, Nonces, signTx } from "./evm"
import { AppError } from "./http"
import { isLegError, trenchy, Trenchy, type TransferCreated, type TransferLegError, type TransferMode } from "./trenchy"
import { accountOf, assertBackedUp, fundingWallet, type WalletInfo } from "./wallets"

/** Left in a wallet when gathering: one plain transfer's gas at today's prices, at least this. */
export const GATHER_RESERVE_ETH = 0.00005

export type FundResult = { publicKey: string; eth: number; hash?: string; confirmed?: boolean; error?: string; code?: string }

function requireFunding(): WalletInfo {
  const f = fundingWallet()
  if (!f) throw new AppError("No ★ wallet yet: create or import one on the Wallets page first", "no_funding_wallet", 400)
  assertBackedUp(f.publicKey)
  return f
}

/** Funding wallet → each target, `eth` each (or a per-target amount). Nothing is sent when any file is missing or the balance is short. */
export async function fundDirect(targets: Array<{ publicKey: string; eth: number }>): Promise<{ from: string; results: FundResult[] }> {
  const funding = requireFunding()
  for (const t of targets) assertBackedUp(t.publicKey) // all or nothing: one missing file refuses the whole request
  const api = trenchy()
  const account = accountOf(funding.publicKey)
  const acct = await api.rh.account(funding.publicKey) // GET /api/rh/account: nonce + fees for the whole run
  const total = targets.reduce((a, t) => a + t.eth, 0) + transferGasEth(acct) * targets.length
  if (Number(acct.balanceEth) < total) throw new AppError(`Funding wallet holds ${acct.balanceEth} ETH; ${total.toFixed(6)} ETH is needed (${targets.length} transfers + gas)`, "insufficient_funds", 409, `Send ETH to ${funding.publicKey} first`)
  const nonces = new Nonces(acct)
  const results: FundResult[] = []
  for (const t of targets) {
    try {
      const raw = await signTx(account, acct, nonces, transferTx(t.publicKey, t.eth, acct))
      const { hash } = await api.rh.send(raw) // POST /api/rh/send
      results.push({ publicKey: t.publicKey, eth: t.eth, hash })
    } catch (e) {
      results.push({ publicKey: t.publicKey, eth: t.eth, error: e instanceof Error ? e.message : String(e), code: (e as { code?: string })?.code })
      break // a failed send leaves the nonce run broken; stop here rather than guess
    }
  }
  for (const r of results) if (r.hash) r.confirmed = await api.waitSuccess(r.hash, 60_000).catch(() => false) // GET /api/rh/tx/:hash
  return { from: funding.publicKey, results }
}

export type ExchangeLeg = { publicKey: string; eth: number; transferId?: string; venue?: string; venueHonoured?: boolean; depositHash?: string; receipt?: string; status?: string; error?: string; code?: string }

/** Funding wallet → each target through an exchange hop. Reduces on-chain linkability between the wallets; it is not anonymity. */
export async function fundViaExchange(targets: Array<{ publicKey: string; eth: number }>, mode: TransferMode = "float", venue = "random"): Promise<{ from: string; batchId?: string; legs: ExchangeLeg[] }> {
  const funding = requireFunding()
  for (const t of targets) assertBackedUp(t.publicKey)
  if (targets.length > 25) throw new AppError("At most 25 wallets per exchange batch", "bad_request", 400)
  const api = trenchy()
  // POST /api/transfer/batch: one order + one unsigned deposit per wallet
  const batch = await api.createTransferBatch({ from: { chain: "rh", wallet: funding.publicKey }, to: targets.map((t) => ({ chain: "rh", address: t.publicKey, amount: t.eth })), mode, venue })
  const account = accountOf(funding.publicKey)
  const acct = await api.rh.account(funding.publicKey)
  const nonces = new Nonces(acct)
  const legs: ExchangeLeg[] = []
  for (const [i, leg] of batch.legs.entries()) {
    const target = targets[i]
    if (isLegError(leg as TransferLegError | TransferCreated)) { const e = leg as TransferLegError; legs.push({ publicKey: e.leg?.to?.address ?? target?.publicKey, eth: e.leg?.amount ?? target?.eth, error: e.error, code: e.code }); continue }
    const t = leg as TransferCreated
    const row: ExchangeLeg = { publicKey: t.to.address, eth: t.amount, transferId: t.transferId, venue: t.venue, venueHonoured: t.venueHonoured, status: t.status }
    try {
      const dep = Trenchy.depositTx(t, funding.publicKey) // checked: our wallet → the leg's deposit address
      const raw = await signTx(account, acct, nonces, dep)
      const { hash } = await api.rh.send(raw) // POST /api/rh/send
      row.depositHash = hash
      await api.transferSent(t.transferId, hash).catch(() => {}) // POST /api/transfer/:id/sent
      row.status = "sent"
    } catch (e) {
      row.error = e instanceof Error ? e.message : String(e)
      row.code = (e as { code?: string })?.code
      legs.push(row)
      break // keep the nonce run intact
    }
    legs.push(row)
  }
  return { from: funding.publicKey, batchId: batch.batchId, legs }
}

/** Each wallet → the funding wallet: everything but a gas reserve. Wallets with nothing to send are skipped. */
export async function gather(publicKeys: string[]): Promise<{ to: string; results: Array<FundResult & { skipped?: string }> }> {
  const funding = requireFunding()
  for (const pk of publicKeys) assertBackedUp(pk)
  const api = trenchy()
  const results: Array<FundResult & { skipped?: string }> = []
  for (const pk of publicKeys) {
    if (pk.toLowerCase() === funding.publicKey.toLowerCase()) { results.push({ publicKey: pk, eth: 0, skipped: "is the ★ wallet" }); continue }
    try {
      const acct = await api.rh.account(pk) // GET /api/rh/account: balance, nonce, fees of this wallet
      const reserve = Math.max(GATHER_RESERVE_ETH, transferGasEth(acct))
      const value = toWei(acct.balanceEth) - toWei(reserve.toFixed(18))
      if (value <= 0n) { results.push({ publicKey: pk, eth: 0, skipped: `holds ${acct.balanceEth} ETH, under the gas reserve` }); continue }
      const raw = await signTx(accountOf(pk), acct, new Nonces(acct), { label: "transfer", to: funding.publicKey, data: "0x", value: value.toString(), gas: acct.transferGas })
      const { hash } = await api.rh.send(raw) // POST /api/rh/send
      results.push({ publicKey: pk, eth: toEth(value), hash })
    } catch (e) {
      results.push({ publicKey: pk, eth: 0, error: e instanceof Error ? e.message : String(e), code: (e as { code?: string })?.code })
    }
  }
  for (const r of results) if (r.hash) r.confirmed = await api.waitSuccess(r.hash, 60_000).catch(() => false)
  return { to: funding.publicKey, results }
}
