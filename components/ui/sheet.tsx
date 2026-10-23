"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"

/** A right-side panel over the page. Closes on Escape and on the backdrop. Rendered on <body> through a portal:
 *  the top bar's backdrop blur would otherwise trap a fixed panel inside the bar's own box. */
export function Sheet({ open, onClose, title, description, children, className }: { open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])
  if (!open || typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="bg-background/60 absolute inset-0 backdrop-blur-[2px]" onClick={onClose} />
      <aside role="dialog" aria-modal className={cn("bg-popover text-popover-foreground relative flex h-full w-full max-w-md flex-col gap-5 overflow-y-auto border-l p-6 shadow-xl", className)}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}><X /></Button>
        </div>
        {children}
      </aside>
    </div>,
    document.body,
  )
}
