"use client"

import * as React from "react"
import { ApiErrorView } from "@/components/api-error"
import { Ext, PonsLink, TxLink } from "@/components/links"
import { WalletPicker, type PickedBuyer } from "@/components/wallet-picker"
import { Button } from "@/components/ui/button"
import { Card, CardHeader } from "@/components/ui/card"
import { Field, Input, Select, Textarea } from "@/components/ui/input"
import { Pill } from "@/components/ui/pill"
import { Mono, Table, TBody, THead } from "@/components/ui/table"
import { api, events, failureOf, post, type ApiFailure } from "@/lib/client"
import { DEMO, TAB_NOTE } from "@/lib/browser/demo"
import { ponsToken, short } from "@/lib/links"
import { cn, fmtEth } from "@/lib/utils"

type Wallet = { publicKey: string; role: string; label: string }
type Plan = { rows: Array<{ publicKey: string; label: string; role: string; buyEth: number; needEth: number; haveEth?: number; shortEth?: number }>; totalEth: number; shortEth?: number; warnings: string[]; dev: string; exempt: number }
type Sim = { predicted?: { token: string; curve: string }; launchFeeEth?: number; expected: { tokens: number; eth: number }; simulation: { ok: boolean; steps: Array<{ label: string; ok: boolean; gasUsed: string | null; error: string | null }> }; exempt: number; warnings: string[] }
type LogEntry = { t: number; stage: string; msg: string; hash?: string; link?: string; level?: "info" | "ok" | "warn" | "error"; done?: boolean }
type Launch = { id: string; createdAt: string; status: string; name: string; symbol: string; token?: string; dev: string; hashes: { create?: string; buys: Array<{ hash?: string; error?: string }> }; error?: string }

const DEFAULT = { name: "", symbol: "", description: "", image: "", twitter: "", telegram: "", website: "", devWallet: "", devBuyEth: "0.001", slippage: "" }
/** Picked buyers → the explicit list the executor takes (lib/launch.ts BuyerGroup.wallets). */
const buyers = (xs: PickedBuyer[]) => xs.map((b) => ({ publicKey: b.publicKey, amount: Number(b.amount) || 0 }))

export default function LaunchPage() {
  const [f, setF] = React.useState(DEFAULT)
  const [wallets, setWallets] = React.useState<Wallet[]>([])
  const [balances, setBalances] = React.useState<Map<string, number>>(new Map())
  const [main, setMain] = React.useState<string | null>(null)
  // three "Pick buyers" groups: the bundle, and snipers / holders under Advanced
  const [bundle, setBundle] = React.useState<PickedBuyer[]>([])
  const [snipers, setSnipers] = React.useState<PickedBuyer[]>([])
  const [holders, setHolders] = React.useState<PickedBuyer[]>([])
  const [advanced, setAdvanced] = React.useState(false)
  const [failure, setFailure] = React.useState<ApiFailure | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [plan, setPlan] = React.useState<Plan | null>(null)
  const [sim, setSim] = React.useState<Sim | null>(null)
  const [log, setLog] = React.useState<LogEntry[]>([])
  const [running, setRunning] = React.useState(false)
  const [launches, setLaunches] = React.useState<Launch[]>([])
  const [fundNote, setFundNote] = React.useState<string | null>(null)

  const set = (k: keyof typeof DEFAULT) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  const body = () => ({
    ...f, devWallet: f.devWallet || undefined, devBuyEth: Number(f.devBuyEth) || 0, slippage: Number(f.slippage) || undefined,
    bundle: { count: bundle.length, eth: 0, wallets: buyers(bundle) }, snipers: { count: snipers.length, eth: 0, wallets: buyers(snipers) }, holders: { count: holders.length, eth: 0, wallets: buyers(holders) },
  })
  const dev = f.devWallet || main
  const total = bundle.length + snipers.length + holders.length
  const taken = (own: PickedBuyer[]) => new Set([...(dev ? [dev] : []), ...[...bundle, ...snipers, ...holders].filter((b) => !own.some((o) => o.publicKey === b.publicKey)).map((b) => b.publicKey)])

  const loadWallets = React.useCallback(async () => {
    const r = await api<{ wallets: Wallet[]; mainWallet: string | null }>("/api/wallets")
    setWallets(r.wallets); setMain(r.mainWallet)
    if (r.wallets.length) api<{ rows: Array<{ publicKey: string; native: number }> }>("/api/wallets/balances").then((b) => setBalances(new Map(b.rows.map((x) => [x.publicKey, x.native])))).catch(() => {})
  }, [])
  const loadLaunches = React.useCallback(() => api<{ launches: Launch[] }>("/api/launch").then((r) => setLaunches(r.launches)).catch(() => {}), [])
  React.useEffect(() => {
    void loadWallets().catch(() => {})
    void loadLaunches()
  }, [loadWallets, loadLaunches])

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setFailure(null)
    try { await fn() } catch (e) { setFailure(failureOf(e)) } finally { setBusy(null) }
  }

  const upload = (file: File | undefined) => run("image", async () => {
    if (!file) return
    const fd = new FormData()
    fd.set("file", file); fd.set("name", f.name || "coin"); fd.set("symbol", f.symbol || "COIN"); fd.set("description", f.description)
    for (const k of ["twitter", "telegram", "website"] as const) if (f[k]) fd.set(k, f[k])
    // POST /api/launch/image → POST /api/ipfs; the create takes metadata.image
    const r = await api<{ image: string }>("/api/launch/image", { method: "POST", body: fd })
    setF((s) => ({ ...s, image: r.image }))
  })
  const makePlan = () => run("plan", async () => { setPlan(await post<Plan>("/api/launch/plan", body())); setFundNote(null) })
  const fund = () => run("fund", async () => {
    const r = await post<{ from: string; results: Array<{ publicKey: string; eth: number; hash?: string; confirmed?: boolean; error?: string }> }>("/api/launch/fund", body())
    setFundNote(r.results.length ? `${r.results.filter((x) => x.hash).length}/${r.results.length} transfers sent from ★ ${short(r.from)}${r.results.some((x) => x.error) ? ` · errors: ${r.results.filter((x) => x.error).map((x) => x.error).join("; ")}` : ""}` : "Nothing to fund: every wallet already holds what the plan asks for")
    setPlan(await post<Plan>("/api/launch/plan", body()))
    void loadWallets()
  })
  const simulate = () => run("simulate", async () => setSim(await post<Sim>("/api/launch/simulate", body())))
  const launch = () => run("launch", async () => {
    if (!confirm(`Launch ${f.name} (${f.symbol}) now with ${total} buyer wallet(s)? This sends real transactions.`)) return
    setLog([]); setRunning(true)
    const { id } = await post<{ id: string }>("/api/launch", body())
    // GET /api/launch/:id/log: server-sent events until the run is done
    const off = events<LogEntry>(`/api/launch/${id}/log`, (e) => { setLog((l) => [...l, e]); if (e.done) { setRunning(false); off(); void loadLaunches() } }, () => setRunning(false))
  })

  const canLaunch = !!f.name && !!f.symbol && /^(https?:\/\/|ipfs:\/\/)/.test(f.image) && !busy && !running

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Launch on pons</h1>
        <p className="text-muted-foreground text-sm">One create transaction; the moment it confirms, your bundle buys go out at once, then snipers, then holders. Every buyer is on the snipe-tax exempt list (up to 31). There is no vanity address on pons: the address is derived from the whole form.</p>
      </div>
      <ApiErrorView failure={failure} />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader title="Coin" description="Name, symbol and image are required; the image goes to IPFS through the API." />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name"><Input value={f.name} onChange={set("name")} /></Field>
            <Field label="Symbol"><Input value={f.symbol} onChange={set("symbol")} /></Field>
            <Field label="Description" className="col-span-2"><Textarea rows={2} value={f.description} onChange={set("description")} /></Field>
            <Field label="Image" hint={f.image ? <span className="font-mono break-all">{f.image}</span> : "PNG, JPG, GIF or WebP, up to 4 MB"} className="col-span-2">
              <div className="flex items-center gap-3">
                <Input type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} disabled={!!busy} />
                {f.image ? <img src={f.image} alt="" className="size-10 rounded-md border object-cover" /> : null}
                {busy === "image" ? <span className="text-muted-foreground text-xs">uploading…</span> : null}
              </div>
            </Field>
            <Field label="Twitter"><Input value={f.twitter} onChange={set("twitter")} placeholder="https://x.com/…" /></Field>
            <Field label="Telegram"><Input value={f.telegram} onChange={set("telegram")} placeholder="https://t.me/…" /></Field>
            <Field label="Website" className="col-span-2"><Input value={f.website} onChange={set("website")} placeholder="https://…" /></Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Dev wallet" description="The dev wallet creates the coin and makes the dev buy. It is ★ unless you pick another." />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dev wallet" className="col-span-2">
              <Select value={f.devWallet} onChange={set("devWallet")}>
                <option value="">★ {wallets.find((w) => w.publicKey === main)?.label ?? "main wallet"}{main ? ` · ${fmtEth(balances.get(main))} ETH` : " (none yet)"}</option>
                {wallets.filter((w) => w.publicKey !== main).map((w) => <option key={w.publicKey} value={w.publicKey}>{w.label} · {short(w.publicKey)} · {fmtEth(balances.get(w.publicKey))} ETH</option>)}
              </Select>
            </Field>
            <Field label="Dev buy (ETH)" hint="Minimum 0.0001; 0 for no dev buy"><Input type="number" step="0.0001" min={0} value={f.devBuyEth} onChange={set("devBuyEth")} /></Field>
            <Field label="Slippage % (blank = settings)"><Input type="number" min={0} max={100} value={f.slippage} onChange={set("slippage")} /></Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={makePlan} disabled={!!busy}>{busy === "plan" ? "…" : "Funding plan"}</Button>
            <Button variant="outline" onClick={simulate} disabled={!canLaunch}>{busy === "simulate" ? "Simulating…" : "Simulate"}</Button>
            <Button onClick={launch} disabled={!canLaunch}>{running ? "Launching…" : "Launch"}</Button>
          </div>
          {DEMO ? <p className="text-muted-foreground text-xs">{TAB_NOTE}</p> : null}
        </Card>
      </div>

      <Card>
        <CardHeader title="Pick buyers" description="Tick the wallets that buy the moment the create confirms (up to 16) and give each its ETH amount. Snipers and holders are under Advanced." />
        <WalletPicker title="Bundle" hint="all at once, as the create confirms" wallets={wallets} balances={balances} mainWallet={main} exclude={taken(bundle)} value={bundle} onChange={setBundle} onWalletsChanged={loadWallets} max={16} />
        <button type="button" className="text-muted-foreground hover:text-foreground self-start text-sm underline-offset-4 hover:underline" onClick={() => setAdvanced((v) => !v)}>
          Advanced {advanced ? "▴" : "▾"}{!advanced && (snipers.length || holders.length) ? <span className="ml-2 text-xs">({snipers.length} sniper{snipers.length === 1 ? "" : "s"} · {holders.length} holder{holders.length === 1 ? "" : "s"})</span> : null}
        </button>
        {advanced ? (
          <>
            <WalletPicker title="Snipers" hint="one by one after the bundle, the gap is in Settings" wallets={wallets} balances={balances} mainWallet={main} exclude={taken(snipers)} value={snipers} onChange={setSnipers} onWalletsChanged={loadWallets} max={500} />
            <WalletPicker title="Holders" hint="spread over the holder window after the delay (Settings)" wallets={wallets} balances={balances} mainWallet={main} exclude={taken(holders)} value={holders} onChange={setHolders} onWalletsChanged={loadWallets} max={500} />
          </>
        ) : null}
        {total > 31 ? <p className="text-warn text-xs">{total} buyers: pons exempts at most 31 from the snipe tax; the rest pay it.</p> : null}
      </Card>

      {plan ? (
        <Card>
          <CardHeader title={`Funding plan · ${fmtEth(plan.totalEth)} ETH total${plan.shortEth ? ` · ${fmtEth(plan.shortEth)} ETH short` : " · fully funded"}`} description={`Per buy: its ETH + 0.5 % API fee + 0.0005 gas reserve; dev adds the 0.0005 pons launch fee. ${plan.exempt} wallets exempt from the snipe tax.`}
            action={<Button size="sm" onClick={fund} disabled={!!busy || !plan.shortEth}>{busy === "fund" ? "Funding…" : "Fund from ★"}</Button>} />
          {plan.warnings.map((w, i) => <p key={i} className="text-warn text-xs">{w}</p>)}
          {fundNote ? <p className="text-sm">{fundNote}</p> : null}
          <Table>
            <THead><tr><th>Wallet</th><th>Role</th><th className="text-right">Buy</th><th className="text-right">Needs</th><th className="text-right">Has</th><th className="text-right">Short</th></tr></THead>
            <TBody>
              {plan.rows.map((r) => (
                <tr key={r.publicKey}><td>{r.label} <Mono className="text-muted-foreground text-xs">{short(r.publicKey)}</Mono></td><td><Pill>{r.role}</Pill></td><td className="text-right font-mono text-xs">{fmtEth(r.buyEth)}</td><td className="text-right font-mono text-xs">{fmtEth(r.needEth)}</td><td className="text-right font-mono text-xs">{fmtEth(r.haveEth)}</td><td className={cn("text-right font-mono text-xs", r.shortEth ? "text-warn" : "text-ok")}>{r.shortEth ? fmtEth(r.shortEth) : "ok"}</td></tr>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}

      {sim ? (
        <Card>
          <CardHeader title={sim.simulation.ok ? "Simulation passed" : "Simulation failed"} description={sim.predicted ? <>Coin would be <Mono>{sim.predicted.token}</Mono> · launch fee {sim.launchFeeEth ?? 0.0005} ETH · dev gets ~{Math.round(sim.expected.tokens).toLocaleString()} tokens · {sim.exempt} exempt wallets. Nothing was sent.</> : "Nothing was sent."} />
          <ul className="flex flex-col gap-1 text-sm">
            {sim.simulation.steps.map((s, i) => <li key={i} className="flex gap-3"><Pill tone={s.ok ? "ok" : "error"}>{s.label}</Pill><span className="text-muted-foreground">{s.ok ? `gas ${s.gasUsed}` : s.error}</span></li>)}
          </ul>
        </Card>
      ) : null}

      {log.length ? (
        <Card>
          <CardHeader title={running ? "Launching…" : "Launch log"} description="Every stage, hash and link as it happens." />
          <ol className="flex flex-col gap-1 font-mono text-xs">
            {log.map((e, i) => (
              <li key={i} className={cn("flex flex-wrap gap-2", e.level === "error" && "text-destructive", e.level === "ok" && "text-ok", e.level === "warn" && "text-warn")}>
                <span className="text-muted-foreground">{new Date(e.t).toLocaleTimeString()}</span><span className="text-muted-foreground w-16">{e.stage}</span><span className="font-sans">{e.msg}</span>
                {e.hash ? <TxLink hash={e.hash} /> : e.link ? <Ext href={e.link}>open</Ext> : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {launches.length ? (
        <Card>
          <CardHeader title="Past launches" description={DEMO ? "Kept in this browser." : "From _app/pons-starter/launches.json."} />
          <Table>
            <THead><tr><th>When</th><th>Coin</th><th>Token</th><th>Status</th><th>Create</th><th>Buys</th><th></th></tr></THead>
            <TBody>
              {launches.map((l) => (
                <tr key={l.id}>
                  <td className="text-muted-foreground text-xs">{new Date(l.createdAt).toLocaleString()}</td><td>{l.name} <span className="text-muted-foreground">{l.symbol}</span></td>
                  <td>{l.token ? <Mono className="text-xs">{short(l.token)}</Mono> : "–"}</td>
                  <td><Pill tone={l.status === "done" ? "ok" : l.status === "failed" ? "error" : "warn"}>{l.status}</Pill>{l.error ? <span className="text-destructive ml-2 text-xs">{l.error.slice(0, 80)}</span> : null}</td>
                  <td>{l.hashes.create ? <TxLink hash={l.hashes.create} /> : "–"}</td>
                  <td className="text-xs">{l.hashes.buys.filter((b) => b.hash).length}/{l.hashes.buys.length}</td>
                  <td>{l.token ? <div className="flex gap-3"><PonsLink token={l.token} /><a className="text-xs underline underline-offset-4" href={`/trading?token=${l.token}`}>trade</a></div> : null}</td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
      <p className="text-muted-foreground text-xs">Token pages open on {ponsToken("0x…")}; hashes on Blockscout.</p>
    </>
  )
}
