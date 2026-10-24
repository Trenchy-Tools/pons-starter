"use client"

import * as React from "react"
import { FolderOpen, KeyRound, Wallet } from "lucide-react"
import { useStatus } from "./providers"
import { Dot, Pill } from "./ui/pill"
import { toast, toastFailure } from "./ui/toast"
import { failureOf, post } from "@/lib/api"
import { DEMO, KEYS_HOME } from "@/lib/browser/demo"
import { short } from "@/lib/links"

/**
 * The right side of the top bar: API key · funding wallet · backup folder. The folder path is always visible.
 * Demo mode: the folder becomes "Keys: this browser · Download backup" (with the count of wallets not backed up yet),
 * and a key that could not be created shows the API's code.
 */
export function StatusStrip() {
  const { status, failure, setSettingsOpen, refresh } = useStatus()
  const [downloading, setDownloading] = React.useState(false)
  const keyTone = status?.status === "connected" ? "ok" : status?.status === "error" || failure ? "error" : "warn"
  const keyText = status?.status === "connected" ? `Connected · ${status.keyPrefix ?? status.apiKeyMasked}` : status?.status === "error" ? "API error" : failure ? "Server unreachable" : status ? (DEMO && status.keyError ? (status.keyError.code ?? "No API key") : "No API key") : "…"
  const pending = status?.pending ?? 0
  const notBackedUp = DEMO && status?.funding && status.funding.backedUp === false
  const downloadBackup = async () => {
    setDownloading(true)
    try {
      const r = await post<{ count: number; files: string[] }>("/api/wallets/backup")
      toast(r.count ? { tone: "ok", title: `Backup downloaded: ${r.count} wallet${r.count === 1 ? "" : "s"}, now usable`, detail: <span className="font-mono text-xs break-all">{r.files.join(" · ")}</span> } : { tone: "muted", title: "Every wallet is already backed up" })
      await refresh()
    } catch (e) {
      toastFailure(failureOf(e))
    } finally {
      setDownloading(false)
    }
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <button type="button" onClick={() => setSettingsOpen(true)} className="cursor-pointer" title={DEMO && status?.keyError ? status.keyError.error : "API key (Settings)"}>
        <Pill tone={keyTone}><Dot tone={keyTone} /><KeyRound className="size-3" />{keyText}</Pill>
      </button>
      <Pill tone={status?.funding ? (notBackedUp ? "error" : "muted") : "warn"} title={status?.funding ? `★ ${status.funding.label} · ${status.funding.publicKey}${notBackedUp ? " · not backed up yet" : ""}` : "Create a wallet on the Wallets page: the first one becomes ★"}>
        <Wallet className="size-3" />{status ? (status.funding ? <span className="font-mono">★ {short(status.funding.publicKey)}</span> : "no ★ wallet") : "…"}
      </Pill>
      {DEMO ? (
        <Pill tone={pending ? "error" : "muted"} title={pending ? `${pending} wallet${pending === 1 ? "" : "s"} not backed up yet: download the backup before funding` : "Every key is backed up. Clearing this site's data deletes the keys stored here."}>
          <FolderOpen className="size-3" />
          <span>Keys: {KEYS_HOME}</span>
          <span>·</span>
          <button type="button" className="cursor-pointer underline underline-offset-4" onClick={() => void downloadBackup()} disabled={downloading}>{downloading ? "Downloading…" : "Download backup"}</button>
          {pending ? <span>({pending})</span> : null}
        </Pill>
      ) : (
        <Pill title={status?.backupDir ?? "backup folder"} className="max-w-[28rem]">
          <FolderOpen className="size-3" /><span className="truncate font-mono">{status?.backupDir ?? "…"}</span>
        </Pill>
      )}
    </div>
  )
}
