"use client";

import { useConnection } from "wagmi";

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT; // bot username, without @

/** Link the wallet to the agent's Telegram bot: a message for every buy, news hold-back, sale and loan rescue. */
export function TelegramAlerts() {
  const { address } = useConnection();
  return (
    <section className="glass mt-6 rounded-3xl p-4">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logos/telegram.svg" alt="" className="size-9" />
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">Telegram alerts</h2>
          <p className="text-xs text-muted">Hear from the agent the moment it acts.</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1 text-xs text-muted">
        <li>✅ It bought for a plan, and why now</li>
        <li>⏸ It held a buy back because of the news</li>
        <li>💰 A sell rule hit and it sold</li>
        <li>🛟 Loan Guard repaid part of your loan</li>
      </ul>
      {!BOT ? (
        <p className="mt-3 text-xs text-muted">The alert bot is not set up on this deployment yet.</p>
      ) : !address ? (
        <p className="mt-3 text-xs text-muted">Connect your wallet first.</p>
      ) : (
        <a href={`https://t.me/${BOT}?start=${address}`} target="_blank" rel="noopener" className="mt-3 block rounded-full bg-[#2aabee] py-2.5 text-center text-sm font-medium text-white">
          Connect Telegram
        </a>
      )}
    </section>
  );
}
