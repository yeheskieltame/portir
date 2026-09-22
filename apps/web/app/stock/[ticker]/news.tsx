import { loadNews } from "@/lib/news";

const ago = (t: number | null) => {
  if (!t) return "";
  const h = Math.max(0, Math.round((Date.now() - t) / 3_600_000));
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

// Rendered inside a Suspense boundary so a slow feed never delays the price.
export async function News({ ticker, name }: { ticker: string; name: string }) {
  const items = await loadNews(ticker).catch(() => []);
  if (items.length === 0) return null;
  return (
    <section className="mt-6 lg:col-start-1">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">News · {name}</h2>
      <ul className="glass mt-2 divide-y divide-line rounded-3xl">
        {items.map((n) => (
          <li key={n.url}>
            <a href={n.url} target="_blank" rel="noopener" className="block px-4 py-3 transition-colors hover:bg-white/5">
              <p className="text-sm leading-snug">{n.title}</p>
              <p className="mt-1 font-mono text-[11px] text-muted">
                {n.source}
                {n.at && ` · ${ago(n.at)}`}
              </p>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Headlines from Yahoo Finance{process.env.COINDESK_API_KEY ? " and CoinDesk" : ""}. Not investment advice.</p>
    </section>
  );
}
