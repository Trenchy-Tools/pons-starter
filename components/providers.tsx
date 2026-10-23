"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import { api, failureOf, type ApiFailure } from "@/lib/client"

export type Status = {
  apiUrl: string; apiKeyMasked: string; apiKeyFrom: "settings" | "env" | "none"
  slippage: number; sniperGapMs: number; holderWindowS: number; holderDelayS: number
  backupDir: string; funding: { publicKey: string; label: string } | null
  status: "connected" | "no_key" | "error"; keyPrefix?: string; error?: ApiFailure; createKeyUrl: string
}

type Ctx = { status: Status | null; failure: ApiFailure | null; refresh: () => Promise<void>; settingsOpen: boolean; setSettingsOpen: (v: boolean) => void }
const StatusContext = React.createContext<Ctx>({ status: null, failure: null, refresh: async () => {}, settingsOpen: false, setSettingsOpen: () => {} })

/** Theme + the app-wide status (GET /api/settings): API key, funding wallet, backup folder. */
export function Providers({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<Status | null>(null)
  const [failure, setFailure] = React.useState<ApiFailure | null>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const refresh = React.useCallback(async () => {
    try { setStatus(await api<Status>("/api/settings")); setFailure(null) } catch (e) { setFailure(failureOf(e)) }
  }, [])
  React.useEffect(() => {
    void refresh()
    // the Wallets page fires this after a create / import / star / archive, so the ★ pill follows
    window.addEventListener("wallets-changed", refresh)
    return () => window.removeEventListener("wallets-changed", refresh)
  }, [refresh])
  return (
    <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange enableColorScheme>
      <StatusContext.Provider value={{ status, failure, refresh, settingsOpen, setSettingsOpen }}>{children}</StatusContext.Provider>
    </NextThemesProvider>
  )
}

export const useStatus = () => React.useContext(StatusContext)
