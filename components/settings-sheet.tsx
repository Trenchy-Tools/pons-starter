"use client"

import * as React from "react"
import { ApiErrorView } from "./api-error"
import { useStatus } from "./providers"
import { Button } from "./ui/button"
import { Field, Input } from "./ui/input"
import { Sheet } from "./ui/sheet"
import { failureOf, put, type ApiFailure } from "@/lib/client"
import { DEMO, DEMO_KEY_LABEL } from "@/lib/browser/demo"

/**
 * API key (+ Connected check), slippage, launch timing, API URL under Advanced; the folder is read-only. Saved to
 * _app/pons-starter/settings.json. Demo mode: the visitor's own key (created in this browser on the first visit, shown
 * masked, replaceable by pasting or "Create a new key"; a refusal is shown exactly as the API sent it), saved in this browser.
 */
export function SettingsSheet() {
  const { status, settingsOpen, setSettingsOpen, refresh } = useStatus()
  const [apiKey, setApiKey] = React.useState("")
  const [slippage, setSlippage] = React.useState("")
  const [gap, setGap] = React.useState("")
  const [window_, setWindow] = React.useState("")
  const [delay, setDelay] = React.useState("")
  const [apiUrl, setApiUrl] = React.useState("")
  const [advanced, setAdvanced] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<ApiFailure | null>(null)

  React.useEffect(() => {
    if (!status) return
    setSlippage(String(status.slippage)); setGap(String(status.sniperGapMs)); setWindow(String(status.holderWindowS)); setDelay(String(status.holderDelayS)); setApiUrl(status.apiUrl)
  }, [status, settingsOpen])

  const save = async () => {
    setBusy(true); setFailure(null)
    try {
      // PUT /api/settings: an empty key keeps the current one; "clear" removes it (back to .env; demo: forgets it)
      await put("/api/settings", {
        ...(apiKey.trim() ? { apiKey: apiKey.trim() === "clear" ? null : apiKey.trim() } : {}),
        slippage: Number(slippage) || null, sniperGapMs: Number(gap) || null, holderWindowS: Number(window_) || null, holderDelayS: Number(delay) || 0,
        apiUrl: apiUrl.trim() || null,
      })
      setApiKey("")
      await refresh()
    } catch (e) { setFailure(failureOf(e)) } finally { setBusy(false) }
  }
  // demo mode: GET /api/create-api-key?label=demo-pons again, from this browser (5 new keys per hour per IP)
  const createKey = async () => {
    setBusy(true); setFailure(null)
    try { await put("/api/settings", { createKey: true }); await refresh() } catch (e) { setFailure(failureOf(e)) } finally { setBusy(false) }
  }
  const keyError = DEMO && status?.keyError && status.status === "no_key" ? ({ status: 0, ...status.keyError } as ApiFailure) : null

  return (
    <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings" description={DEMO ? "Saved in this browser. Your API key was made for you on your first visit; it is yours alone." : "Saved in the wallet folder under _app/pons-starter/settings.json; .env provides the defaults."}>
      <ApiErrorView failure={failure ?? status?.error ?? null} />
      {DEMO ? (
        <Field label="API key" hint={<>{status?.apiKeyMasked ? <>Your key, kept in this browser: {status.apiKeyMasked}. Paste another to replace it, or type <code>clear</code> to forget it.</> : "No key yet."} Status: <b>{status?.status ?? "…"}</b>. <button type="button" className="cursor-pointer underline underline-offset-4" onClick={() => void createKey()} disabled={busy} title={`GET /api/create-api-key?label=${DEMO_KEY_LABEL}`}>Create a new key</button></>}>
          <Input type="password" autoComplete="off" placeholder={status?.apiKeyMasked ? "•••••••••••••• (unchanged)" : "paste your key"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </Field>
      ) : (
        <Field label="API key" hint={<>Current: {status?.apiKeyMasked || "none"} ({status?.apiKeyFrom}). Status: <b>{status?.status ?? "…"}</b>. Get one with <a className="underline underline-offset-4" href={status?.createKeyUrl} target="_blank" rel="noreferrer">GET /api/create-api-key</a> (shown once). Type <code>clear</code> to remove the saved key.</>}>
          <Input type="password" autoComplete="off" placeholder="paste a key to replace the current one" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </Field>
      )}
      {keyError ? (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Creating your key failed. The API said:</span>
          <ApiErrorView failure={keyError} />
          <span className="text-muted-foreground text-xs">Paste a key you already have above, or try again later.</span>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Slippage %"><Input type="number" min={0} max={100} value={slippage} onChange={(e) => setSlippage(e.target.value)} /></Field>
        <Field label="Sniper gap (ms)"><Input type="number" min={0} value={gap} onChange={(e) => setGap(e.target.value)} /></Field>
        <Field label="Holder window (s)"><Input type="number" min={1} value={window_} onChange={(e) => setWindow(e.target.value)} /></Field>
        <Field label="Holder delay (s)"><Input type="number" min={0} value={delay} onChange={(e) => setDelay(e.target.value)} /></Field>
      </div>
      {DEMO ? (
        <Field label="Keys" hint="Every wallet lives in this browser only. Download backup saves the keys as a file; clearing this site's data deletes them.">
          <Input readOnly value={`${status?.backupDir ?? ""} (localStorage)`} className="font-mono text-xs" />
        </Field>
      ) : (
        <Field label="Backup folder (read-only)" hint="Set WALLET_BACKUP_DIR in .env to move it. Every wallet file lives here; nothing is funded without its file.">
          <Input readOnly value={status?.backupDir ?? ""} className="font-mono text-xs" />
        </Field>
      )}
      {DEMO ? null : <button type="button" className="text-muted-foreground self-start text-xs underline underline-offset-4" onClick={() => setAdvanced((v) => !v)}>{advanced ? "Hide" : "Show"} advanced</button>}
      {advanced && !DEMO ? (
        <Field label="API URL" hint="Default https://api.trenchy.tools">
          <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} className="font-mono text-xs" />
        </Field>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        <Button variant="outline" onClick={() => void refresh()} disabled={busy}>Re-check connection</Button>
      </div>
    </Sheet>
  )
}
