"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="glass mt-10 rounded-3xl p-5 text-sm">
      <h1 className="text-xl">Something went wrong</h1>
      <p className="mt-2 text-muted">Usually the market data feed. Nothing was sent from your wallet.</p>
      {process.env.NODE_ENV !== "production" && <p className="mt-2 break-words font-mono text-xs text-block">{error.message}</p>}
      <button onClick={reset} className="mt-4 rounded-full bg-white px-4 py-2 font-medium text-black">Try again</button>
    </div>
  );
}
