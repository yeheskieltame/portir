import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import { ConnectButton } from "./connect-button";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} antialiased`}>
      <body className="font-sans">
        <Providers>
          <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-28">
            <header className="flex items-center justify-between py-4">
              <Link href="/" className="text-2xl tracking-tight">
                Port<span className="serif-italic text-[1.2em]">ir</span>
              </Link>
              <ConnectButton />
            </header>
            <main className="flex-1">{children}</main>
          </div>
          <Nav />
        </Providers>
      </body>
    </html>
  );
}
