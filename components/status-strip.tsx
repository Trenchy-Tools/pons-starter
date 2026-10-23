"use client"

import { FolderOpen, KeyRound, Wallet } from "lucide-react"
import { useStatus } from "./providers"
import { Dot, Pill } from "./ui/pill"
import { short } from "@/lib/links"

/** The right side of the top bar: API key · funding wallet · backup folder. The folder path is always visible. */
export function StatusStrip() {
  const { status, failure, setSettingsOpen } = useStatus()
  const keyTone = status?.status === "connected" ? "ok" : status?.status === "error" || failure ? "error" : "warn"
  const keyText = status?.status === "connected" ? `Connected · ${status.keyPrefix ?? status.apiKeyMasked}` : status?.status === "error" ? "API error" : failure ? "Server unreachable" : status ? "No API key" : "…"
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <button type="button" onClick={() => setSettingsOpen(true)} className="cursor-pointer" title="API key (Settings)">
        <Pill tone={keyTone}><Dot tone={keyTone} /><KeyRound className="size-3" />{keyText}</Pill>
      </button>
      <Pill tone={status?.funding ? "muted" : "warn"} title={status?.funding ? `★ ${status.funding.label} · ${status.funding.publicKey}` : "Create a wallet on the Wallets page: the first one becomes ★"}>
        <Wallet className="size-3" />{status ? (status.funding ? <span className="font-mono">★ {short(status.funding.publicKey)}</span> : "no ★ wallet") : "…"}
      </Pill>
      <Pill title={status?.backupDir ?? "backup folder"} className="max-w-[28rem]">
        <FolderOpen className="size-3" /><span className="truncate font-mono">{status?.backupDir ?? "…"}</span>
      </Pill>
    </div>
  )
}
