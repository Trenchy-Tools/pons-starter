import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const fmtEth = (n: number | string | undefined | null, d = 5) => (n === undefined || n === null ? "–" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d }))
export const fmtTokens = (n: number | undefined | null) => (n === undefined || n === null ? "–" : n >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 }))
