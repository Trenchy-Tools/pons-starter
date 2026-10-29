"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Settings } from "lucide-react"
import { Logo } from "./logo"
import { MoreMenu } from "./more-menu"
import { SettingsSheet } from "./settings-sheet"
import { ThemeToggle } from "./theme-toggle"
import { useStatus } from "./providers"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/launch", label: "Launch" },
  { href: "/trading", label: "Trading" },
  { href: "/wallets", label: "Wallets" },
]
const LIVE = "https://pons.trenchy.tools"
const REPO = "https://github.com/Trenchy-Tools/trenchytools-pons-launcher"

/**
 * Seven targets: wordmark · Launch · Trading · Wallets · one status dot (opens Settings) · Get an API key · ⋯ menu
 * (docs, examples, GitHub, theme, Settings). Everything about keys, wallets and folders lives behind the dot.
 */
export function TopBar() {
  const path = usePathname()
  const { status, failure, setSettingsOpen } = useStatus()
  const pending = status?.pending ?? 0
  const connected = status?.status === "connected"
  const rejected = status?.status === "error" || !!failure
  const tone = !status && !failure ? "bg-muted-foreground" : rejected ? "bg-destructive" : connected && status?.funding && !pending ? "bg-ok" : "bg-warn"
  const text = !status && !failure ? "checking…" : failure ? "app server unreachable" : rejected ? "API key rejected" : !connected ? "no API key yet" : !status?.funding ? "key ok · no ★ wallet yet" : pending ? `${pending} wallet${pending === 1 ? "" : "s"} not backed up` : "key ok · ★ ready"
  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="flex h-14 w-full items-center gap-6 px-5 sm:px-6">
        <Link href="/launch" aria-label="TrenchyTools pons starter" className="flex text-[17px]"><Logo /></Link>
        <nav className="flex items-center gap-1 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("rounded-md px-2.5 py-1.5 transition-colors", path.startsWith(n.href) ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setSettingsOpen(true)} className="text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs transition-colors" title={`${text}. Click for Settings.`}>
            <span className={cn("size-2 rounded-full", tone)} />
            <span className="hidden sm:inline">{text}</span>
          </button>
          <a href="https://trenchy.tools/docs/api-keys" target="_blank" rel="noreferrer" className="bg-foreground text-background inline-flex h-8 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-opacity hover:opacity-90">Get an API key</a>
          <MoreMenu current={LIVE} repo={REPO}>
            <div className="flex items-center justify-between px-2.5 py-1.5 text-sm"><span>Theme</span><ThemeToggle /></div>
            <button type="button" className="hover:bg-muted flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm" onClick={() => setSettingsOpen(true)}><Settings className="size-4" /> Settings</button>
          </MoreMenu>
        </div>
      </div>
      <SettingsSheet />
    </header>
  )
}
