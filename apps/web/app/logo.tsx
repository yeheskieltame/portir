/* eslint-disable @next/next/no-img-element */
export function Logo({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  const initials = name.replace(/\(.*\)/, "").trim().slice(0, 2).toUpperCase();
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 font-mono text-xs font-medium"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* The Binance CDN refuses hotlinks with a referer. */}
      {src ? <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" className="size-full object-cover" /> : initials}
    </span>
  );
}
