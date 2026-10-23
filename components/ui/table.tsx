import * as React from "react"
import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto rounded-lg border">
      <table data-slot="table" className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  )
}
function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-muted/60 text-muted-foreground [&_th]:h-9 [&_th]:px-3 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium", className)} {...props} />
}
function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_td]:px-3 [&_td]:py-2 [&_tr]:border-t", className)} {...props} />
}
/** Row / header cell / cell, the same names the pump.fun starter's table exports, so the shared pages render in both. */
function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("hover:bg-muted/40 data-[selected=true]:bg-muted/60 transition-colors", className)} {...props} />
}
function TH({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("align-middle tracking-wide uppercase whitespace-nowrap", className)} {...props} />
}
function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("align-middle whitespace-nowrap", className)} {...props} />
}
function Mono({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("font-mono text-[13px]", className)} {...props} />
}

export { Table, THead, TBody, TR, TH, TD, Mono }
