/** Where things are seen: the pons page of a coin and Blockscout for Robinhood Chain. Shared by server and client. */
export const PONS_URL = "https://ponsfamily.com"
export const BLOCKSCOUT_URL = "https://robinhoodchain.blockscout.com"

export const ponsToken = (token: string) => `${PONS_URL}/launchpad/${token}`
export const txLink = (hash: string) => `${BLOCKSCOUT_URL}/tx/${hash}`
export const addressLink = (address: string) => `${BLOCKSCOUT_URL}/address/${address}`
export const tokenLink = (token: string) => `${BLOCKSCOUT_URL}/token/${token}`

export const short = (s: string, n = 6) => (s.length > n * 2 + 3 ? `${s.slice(0, n + 2)}…${s.slice(-n)}` : s)
