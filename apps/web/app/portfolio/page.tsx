import { cookies } from "next/headers";
import { loadTokens } from "@/lib/live";
import { MODE_COOKIE, NET, asMode } from "@/lib/mode";
import { TESTNET } from "@/lib/testnet";
import { Holdings } from "./holdings";

export const revalidate = 300;

export default async function Portfolio({ searchParams }: PageProps<"/portfolio">) {
  const [sp, jar] = await Promise.all([searchParams, cookies()]);
  const mode = asMode(jar.get(MODE_COOKIE)?.value);
  // Testnet holdings are the MockStocks (1 token = 1 share); mainnet holdings are every issuer's token.
  const tokens = mode === "testnet" ? Object.entries(TESTNET.stocks).map(([ticker, address]) => ({ ticker, address, multiplier: 1 })) : await loadTokens();
  return (
    <>
      <h1 className="mt-4 text-[34px] leading-[1] tracking-[-0.03em]">
        Your <span className="serif-italic text-[1.1em]">portfolio.</span>
      </h1>
      {/* ?preview=1 opens the sample portfolio directly: handy for demo links. */}
      <Holdings tokens={tokens} chainId={NET[mode].chain.id} initialPreview={sp.preview === "1"} />
    </>
  );
}
