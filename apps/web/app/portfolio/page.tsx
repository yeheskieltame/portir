import { loadCatalog } from "@/lib/live";
import { Holdings } from "./holdings";

export const revalidate = 30;

export default async function Portfolio() {
  const { stocks } = await loadCatalog();
  return (
    <>
      <h1 className="mt-4 text-[34px] leading-[1] tracking-[-0.03em]">
        Your <span className="serif-italic text-[1.1em]">portfolio.</span>
      </h1>
      <Holdings
        stocks={stocks.map((s) => ({
          ticker: s.ticker,
          name: s.name,
          icon: s.icon,
          onchain: s.onchain,
          change24hPct: s.change24hPct,
          tokens: (s.offers ?? []).map((o) => ({ address: o.contractAddress as `0x${string}`, multiplier: o.multiplier })),
        }))}
      />
    </>
  );
}
