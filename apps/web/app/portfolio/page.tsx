import { loadTokens } from "@/lib/live";
import { Holdings } from "./holdings";

export const revalidate = 300;

export default async function Portfolio({ searchParams }: PageProps<"/portfolio">) {
  const [tokens, sp] = await Promise.all([loadTokens(), searchParams]);
  return (
    <>
      <h1 className="mt-4 text-[34px] leading-[1] tracking-[-0.03em]">
        Your <span className="serif-italic text-[1.1em]">portfolio.</span>
      </h1>
      {/* ?preview=1 opens the sample portfolio directly: handy for demo links. */}
      <Holdings tokens={tokens} initialPreview={sp.preview === "1"} />
    </>
  );
}
