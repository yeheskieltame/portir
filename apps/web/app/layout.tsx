import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ConnectButton } from "./connect-button";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Portir",
  description: "US stocks on BNB Chain, bought at a fair price.",
};
export const viewport: Viewport = { themeColor: "#f6f3ec" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="font-sans">
        <Providers>
          <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10">
            <header className="flex items-center justify-between py-4">
              <nav className="flex items-baseline gap-5">
                <Link href="/" className="text-lg font-semibold tracking-tight text-brand">
                  Portir
                </Link>
                <Link href="/" className="text-sm text-muted hover:text-ink">
                  Stocks
                </Link>
                <Link href="/plans" className="text-sm text-muted hover:text-ink">
                  Plans
                </Link>
              </nav>
              <ConnectButton />
            </header>
            <main className="flex-1">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
