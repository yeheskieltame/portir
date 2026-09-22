import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import { cookies } from "next/headers";
import { MODE_COOKIE, asMode } from "@/lib/mode";
import { ConnectButton } from "./connect-button";
import { ModeProvider } from "./mode";
import { Nav } from "./nav";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: "italic" });

export const metadata: Metadata = {
  title: "Portir",
  description: "US stocks on BNB Chain, bought at a fair price.",
};
export const viewport: Viewport = { themeColor: "#04070d" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const mode = asMode((await cookies()).get(MODE_COOKIE)?.value);
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} antialiased`}>
      <body className="font-sans">
        <Providers>
          <ModeProvider mode={mode}>
          <Nav />
          {/* Phone: one column with a tab bar. Desktop: sidebar + a wide content area. */}
          <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-32 lg:ml-60 lg:max-w-none lg:px-10 lg:pb-16 xl:px-16">
            <header className="flex items-center justify-between py-4 lg:py-6">
              <Link href="/" className="text-2xl tracking-tight lg:invisible">
                Port<span className="serif-italic text-[1.2em]">ir</span>
              </Link>
              <div className="flex items-center gap-2">
                {mode === "testnet" && <Link href="/profile" className="rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-warn">Testnet</Link>}
                <ConnectButton />
              </div>
            </header>
            <main className="flex-1 lg:mx-auto lg:w-full lg:max-w-6xl">{children}</main>
          </div>
          </ModeProvider>
        </Providers>
      </body>
    </html>
  );
}
