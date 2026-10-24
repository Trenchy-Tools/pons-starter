"use client"

/**
 * EVM keys in the browser (demo mode): make a wallet, read a pasted secret, turn a stored secret into a signer.
 * The only chain-specific piece of the browser kit; the pump.fun starter's twin (signer-sol.ts) does the same with a
 * Solana Keypair. Transactions are signed with the viem account this returns (`account.signTransaction`, through
 * lib/core/evm.ts signTx / sendAll), exactly as on the server.
 */
import { getAddress, isAddress as viemIsAddress } from "viem"
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts"
import { normalizeKey } from "../core/evm"

/** A new wallet: checksummed 0x address + 0x hex private key (the wallet-file format). */
export function generateKey(): { publicKey: string; privateKey: string } {
  const privateKey = generatePrivateKey()
  return { publicKey: privateKeyToAccount(privateKey).address, privateKey }
}

/** A pasted 0x (or bare 64-hex) private key → its normalized form and address. Throws on anything else. */
export function parseSecret(secret: string): { publicKey: string; privateKey: string } {
  const privateKey = normalizeKey(secret) // "Not a valid private key: expected 0x followed by 64 hex characters"
  return { publicKey: privateKeyToAccount(privateKey).address, privateKey }
}

/** The signer of a stored secret. Checks that the secret really is the key of `publicKey`. */
export function signerOf(publicKey: string, privateKey: string): PrivateKeyAccount {
  const account = privateKeyToAccount(normalizeKey(privateKey))
  if (account.address.toLowerCase() !== publicKey.toLowerCase()) throw new Error(`The stored key of ${publicKey.slice(0, 10)}… does not match its address`)
  return account
}

/** A 0x address (any letter case; a mixed-case one must carry a valid checksum). */
export const isAddress = (s: string) => viemIsAddress(s.trim())

/** The checksummed form of an address. */
export const checksum = (s: string) => getAddress(s.trim())
