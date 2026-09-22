"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext } from "react";
import { MODE_COOKIE, type Mode } from "@/lib/mode";

const Ctx = createContext<Mode>("testnet");

/** The server reads the cookie once per request and hands the mode down; the client switches it by rewriting the cookie. */
export function ModeProvider({ mode, children }: { mode: Mode; children: React.ReactNode }) {
  return <Ctx.Provider value={mode}>{children}</Ctx.Provider>;
}

export const useMode = () => useContext(Ctx);

export function useSetMode() {
  const router = useRouter();
  return (mode: Mode) => {
    document.cookie = `${MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
}
