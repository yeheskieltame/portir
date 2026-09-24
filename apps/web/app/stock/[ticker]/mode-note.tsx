"use client";

import Link from "next/link";
import { useMode } from "@/app/mode";
import { TESTNET } from "@/lib/testnet";

export function ModeNote({ ticker }: { ticker: string }) {
  const mode = useMode();
  if (mode !== "testnet") return null;
  const listed = ticker in TESTNET.stocks;
  return (
    <p className="mt-2 text-xs text-muted">
      <span className="text-warn">Testnet mode.</span>{" "}
      {listed ? "Buys settle on BSC testnet with tUSDT at the mirrored on-chain price." : "This stock is not on the testnet exchange; the featured stocks and every basket holding are."}{" "}
      <Link href="/profile" className="underline">Switch mode</Link>
    </p>
  );
}
