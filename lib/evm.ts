/**
 * The signer. Keys are 0x hex private keys (viem `privateKeyToAccount`); the chain is Robinhood Chain (id 4663).
 *
 * This app never talks to an RPC node. Everything a signature needs that only the chain knows (chainId, nonce, gas
 * prices) comes from GET /api/rh/account (lib/trenchy.ts `rh.account`); the transactions themselves come from the
 * API (`trade-local`, transfer deposits) or are the one plain transfer this file builds: `{ to, value, gas: 21000 }`.
 */
import { formatEther, parseEther, type Address, type Hex } from "viem"
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts"

export const RH_CHAIN_ID = 4663

/** One unsigned transaction as the API hands it out (`trade-local` entries, transfer deposits). `gas` may be missing. */
export type UnsignedTx = { label?: string; to: string; data?: string; value: string; gas?: string | number; from?: string; chainId?: number }

/** What GET /api/rh/account returns: enough to sign a run of transactions without an RPC node. */
export type AccountData = {
  wallet: string; chainId: number; nonce: number; pendingNonce: number; balanceEth: string; block: number
  gasPrice: string; maxFeePerGas: string; maxPriorityFeePerGas: string; transferGas: string
}

/** Gas when the API does not say: pons trades fit comfortably. */
const DEFAULT_GAS = 600_000n

export function accountFrom(privateKey: string): PrivateKeyAccount {
  return privateKeyToAccount(normalizeKey(privateKey))
}

export function newPrivateKey(): Hex {
  return generatePrivateKey()
}

/** Accept a 0x key or a bare 64-hex key. Throws on anything else. */
export function normalizeKey(key: string): Hex {
  const k = key.trim()
  const hex = k.startsWith("0x") ? k : `0x${k}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("Not a valid private key: expected 0x followed by 64 hex characters")
  return hex as Hex
}

/**
 * A nonce counter for one wallet in one batch: take `pendingNonce` once, add 1 per transaction. Pass the same
 * `Nonces` to every sign() of a run; a fresh one (fresh account read) after any send failure.
 */
export class Nonces {
  private next: number
  constructor(acct: AccountData) { this.next = acct.pendingNonce }
  take(): number { return this.next++ }
}

/** Sign one API transaction with the account data: chainId + nonce + EIP-1559 fees. Returns the raw 0x bytes for POST /api/rh/send. */
export async function signTx(account: PrivateKeyAccount, acct: AccountData, nonces: Nonces, tx: UnsignedTx): Promise<Hex> {
  if (tx.from && tx.from.toLowerCase() !== account.address.toLowerCase()) throw new Error(`transaction is for ${tx.from}, not ${account.address}`)
  const chainId = tx.chainId ?? acct.chainId ?? RH_CHAIN_ID
  if (chainId !== RH_CHAIN_ID) throw new Error(`unexpected chainId ${chainId} (Robinhood Chain is ${RH_CHAIN_ID})`)
  return account.signTransaction({
    type: "eip1559",
    chainId,
    nonce: nonces.take(),
    to: tx.to as Address,
    data: ((tx.data as Hex) || "0x") as Hex,
    value: BigInt(tx.value || "0"),
    gas: tx.gas ? BigInt(tx.gas) : DEFAULT_GAS,
    maxFeePerGas: BigInt(acct.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(acct.maxPriorityFeePerGas),
  })
}

/** A plain ETH transfer, as GET /api/rh/account describes it: `{ to, value, gas: 21000 }`. */
export function transferTx(to: string, eth: number | string, acct?: AccountData): UnsignedTx {
  return { label: "transfer", to, data: "0x", value: parseEther(String(eth) as `${number}`).toString(), gas: acct?.transferGas ?? "21000" }
}

export const toEth = (wei: bigint | string): number => Number(formatEther(BigInt(wei)))
export const toWei = (eth: number | string): bigint => parseEther(String(eth) as `${number}`)
/** The gas a plain transfer costs at the account's current maxFeePerGas, in ETH. */
export const transferGasEth = (acct: AccountData): number => toEth(BigInt(acct.transferGas || 21000) * BigInt(acct.maxFeePerGas))
