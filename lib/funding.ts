/**
 * Moving ETH between the folder's wallets, in local mode: the flows in lib/core/funding.ts (fundDirect,
 * fundViaExchange, gather) run on the wallet folder (lib/env.ts). All refuse a wallet whose file is missing.
 */
import * as core from "./core/funding"
import { serverEnv } from "./env"
import type { TransferMode } from "./trenchy"

export { GATHER_RESERVE_ETH } from "./core/funding"
export type { ExchangeLeg, FundResult } from "./core/funding"

export const fundDirect = (targets: Array<{ publicKey: string; eth: number }>) => core.fundDirect(serverEnv(), targets)
export const fundViaExchange = (targets: Array<{ publicKey: string; eth: number }>, mode: TransferMode = "float", venue = "random") => core.fundViaExchange(serverEnv(), targets, mode, venue)
export const gather = (publicKeys: string[]) => core.gather(serverEnv(), publicKeys)
export const sendDirect = (publicKeys: string[], to: string, amount: number | "max") => core.sendDirect(serverEnv(), publicKeys, to, amount)
