"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Settings } from "lucide-react"
import { Logo } from "./logo"
import { SettingsSheet } from "./settings-sheet"
import { StatusStrip } from "./status-strip"
import { ThemeToggle } from "./theme-toggle"
import { Button } from "./ui/button"
import { useStatus } from "./providers"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/launch", label: "Launch" },
  { href: "/trading", label: "Trading" },
  { href: "/wallets", label: "Wallets" },
]

/** The docs site's header layout: logo · pages · (right) status pills · theme · settings. */
export function TopBar() {
  const path = usePathname()
  const { setSettingsOpen } = useStatus()
  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="flex min-h-14 w-full flex-wrap items-center gap-x-8 gap-y-2 px-5 py-2 sm:px-6">
        <Link href="/launch" aria-label="TrenchyTools pons starter" className="flex text-[17px]"><Logo /></Link>
        <nav className="flex items-center gap-1 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("rounded-md px-2.5 py-1.5 transition-colors", path.startsWith(n.href) ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <StatusStrip />
          <ThemeToggle className="hidden sm:flex" />
          <Button variant="outline" size="icon-sm" aria-label="Settings" onClick={() => setSettingsOpen(true)}><Settings /></Button>
        </div>
      </div>
      <SettingsSheet />
    </header>
  )
}
