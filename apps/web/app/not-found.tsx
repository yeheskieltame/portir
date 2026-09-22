import Link from "next/link";

export default function NotFound() {
  return (
    <div className="glass mt-10 rounded-3xl p-5 text-sm">
      <h1 className="text-xl">Not on BNB Chain yet</h1>
      <p className="mt-2 text-muted">That stock or basket is not listed. 510 US stocks and ETFs are.</p>
      <Link href="/" className="mt-4 inline-block rounded-full bg-white px-4 py-2 font-medium text-black">Browse markets</Link>
    </div>
  );
}
