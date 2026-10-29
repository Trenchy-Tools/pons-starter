import type { Metadata } from "next"
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google"
import { DemoBanner } from "@/components/demo-banner"
import { Providers } from "@/components/providers"
import { TopBar } from "@/components/top-bar"
import { Toaster } from "@/components/ui/toast"
import "./globals.css"

// The docs site's fonts: Space Grotesk for text, IBM Plex Mono for addresses, hashes and code.
const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans" })
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" })

const DESCRIPTION = process.env.NEXT_PUBLIC_DEMO === "1" ? "Launch and trade pons coins on Robinhood Chain with the TrenchyTools API, from your browser." : "Launch and trade pons coins on Robinhood Chain with the TrenchyTools API."
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://pons.trenchy.tools"),
  openGraph: { type: "website", siteName: "TrenchyTools", title: "pons launcher · TrenchyTools", description: DESCRIPTION, images: [{ url: "/og.png", width: 1280, height: 640, alt: "pons launcher on the TrenchyTools API" }] },
  twitter: { card: "summary_large_image", site: "@trenchytools", title: "pons launcher · TrenchyTools", description: DESCRIPTION, images: ["/og.png"] },
  title: { default: "pons starter · TrenchyTools", template: "%s · pons starter" },
  description: process.env.NEXT_PUBLIC_DEMO === "1" ? "Launch and trade pons coins on Robinhood Chain with the TrenchyTools API, from your browser." : "Launch and trade pons coins on Robinhood Chain with the TrenchyTools API.",
  icons: { icon: "/icon.svg" },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="bg-background text-foreground min-h-dvh font-sans antialiased">
        <Providers>
          <TopBar />
          <DemoBanner />
          <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-6 sm:px-6">{children}</main>
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
