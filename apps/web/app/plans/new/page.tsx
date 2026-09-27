"use client";

import Link from "next/link";
import { FlowEditor } from "@/app/flow/editor";

export default function NewPlan() {
  return (
    <>
      <Link href="/plans" className="mt-4 inline-block text-sm text-muted">← Plans</Link>
      <h1 className="mt-3 text-[34px] leading-[1] tracking-[-0.03em]">
        Build a plan, <span className="serif-italic text-[1.1em]">step by step.</span>
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-muted">This is exactly what the agent will do on every run. Tap a step to change it; the flow updates as you go.</p>
      <div className="mt-6">
        <FlowEditor initial={{ target: "BASKET:AI & Semis", amount: "50", days: 7, once: false, smart: true }} />
      </div>
    </>
  );
}
