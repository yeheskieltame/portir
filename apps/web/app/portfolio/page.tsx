import { loadTokens } from "@/lib/live";
import { Holdings } from "./holdings";

export const revalidate = 300;

export default async function Portfolio() {
  const tokens = await loadTokens();
  return (
    <>
      <h1 className="mt-4 text-[34px] leading-[1] tracking-[-0.03em]">
        Your <span className="serif-italic text-[1.1em]">portfolio.</span>
      </h1>
      <Holdings tokens={tokens} />
    </>
  );
}
