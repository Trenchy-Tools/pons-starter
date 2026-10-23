import { ExternalLink } from "lucide-react"
import { addressLink, ponsToken, short, txLink } from "@/lib/links"
import { cn } from "@/lib/utils"

export function Ext({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 underline-offset-4 hover:underline", className)}>
      {children}<ExternalLink className="size-3 opacity-60" />
    </a>
  )
}

export const TxLink = ({ hash }: { hash: string }) => <Ext href={txLink(hash)} className="font-mono text-xs">{short(hash, 5)}</Ext>
export const AddrLink = ({ address, full }: { address: string; full?: boolean }) => <Ext href={addressLink(address)} className="font-mono text-[13px]">{full ? address : short(address)}</Ext>
export const PonsLink = ({ token, label }: { token: string; label?: string }) => <Ext href={ponsToken(token)} className="text-xs">{label ?? "pons page"}</Ext>

/** Copy-to-clipboard text button. */
export function Copy({ text, className }: { text: string; className?: string }) {
  return (
    <button type="button" className={cn("text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline", className)} onClick={() => void navigator.clipboard.writeText(text)}>
      copy
    </button>
  )
}
