import { body, fail, ok } from "@/lib/http"
import { BACKUP_DIR } from "@/lib/paths"
import { effectiveSettings, updateSettings, type Settings } from "@/lib/settings"
import { trenchy } from "@/lib/trenchy"
import { fundingWallet } from "@/lib/wallets"

export const dynamic = "force-dynamic"

/**
 * GET /api/settings → the effective settings (key masked), the backup folder, the funding wallet and the connection
 * check: GET /api/me on the TrenchyTools API with the configured key → status "connected" | "no_key" | "error".
 */
export async function GET() {
  const s = effectiveSettings()
  let status: "connected" | "no_key" | "error" = "no_key"
  let keyPrefix: string | undefined
  let error: { error: string; code?: string; hint?: string; docs?: string } | undefined
  if (s.apiKey) {
    try {
      const me = await trenchy().me()
      status = "connected"
      keyPrefix = me.keyPrefix
    } catch (e) {
      status = "error"
      error = typeof (e as { toJSON?: () => unknown }).toJSON === "function" ? ((e as { toJSON: () => typeof error }).toJSON() as typeof error) : { error: e instanceof Error ? e.message : String(e) }
    }
  }
  return ok({
    apiUrl: s.apiUrl, apiKeyMasked: s.apiKey ? `${s.apiKey.slice(0, 4)}…${s.apiKey.slice(-4)}` : "", apiKeyFrom: s.apiKeyFrom,
    slippage: s.slippage, sniperGapMs: s.sniperGapMs, holderWindowS: s.holderWindowS, holderDelayS: s.holderDelayS,
    backupDir: BACKUP_DIR, funding: fundingWallet(), status, keyPrefix, error,
    createKeyUrl: `${s.apiUrl}/api/create-api-key?label=pons-starter`,
  })
}

/** PUT /api/settings { apiKey?, apiUrl?, slippage?, sniperGapMs?, holderWindowS?, holderDelayS? } → saved to _app/pons-starter/settings.json. null clears a field. */
export async function PUT(req: Request) {
  const b = await body<{ [K in keyof Settings]: Settings[K] | null }>(req)
  try {
    updateSettings(b)
    return GET()
  } catch (e) {
    return fail(e)
  }
}
