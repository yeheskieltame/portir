"use client";

import "@xyflow/react/dist/style.css";
import { Background, BackgroundVariant, Controls, type Edge, type FitViewOptions, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useSyncExternalStore } from "react";
import type { Layout, StepKind, StepNode } from "./model";
import { nodeTypes } from "./step-node";

/** Read-only or clickable flow canvas. Nodes never move; the layout is part of the meaning. */
/** Phones get the one-column flow; the two-row flow needs width. */
export function useFlowLayout(): Layout {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(max-width: 1023px)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => (window.matchMedia("(max-width: 1023px)").matches ? "tall" : "wide"),
    () => "wide",
  );
}

export function FlowCanvas({ nodes, edges, onPick, height, className = "", padding = 0.1, controls = true, fitIds, children }: { nodes: StepNode[]; edges: Edge[]; onPick?: (kind: StepKind) => void; height?: number; className?: string; padding?: FitViewOptions["padding"]; controls?: boolean; fitIds?: string[]; children?: React.ReactNode }) {
  // A tall (phone) flow is fitted on its first steps at a readable zoom; the rest is a drag away.
  const fitNodes = fitIds?.filter((id) => nodes.some((n) => n.id === id)).map((id) => ({ id }));
  return (
    <div className={`portir-flow relative overflow-hidden rounded-3xl border border-line bg-[#060a12] ${className}`} style={height ? { height } : undefined}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding, nodes: fitNodes?.length ? fitNodes : undefined }}
          minZoom={0.2}
          maxZoom={1.6}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={!!onPick}
          onNodeClick={onPick ? (_, n) => n.data.editable && onPick(n.data.kind) : undefined}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch
          preventScrolling={false}
          colorMode="dark"
          style={{ background: "transparent" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgba(255,255,255,0.08)" />
          {controls && <Controls showInteractive={false} position="bottom-right" />}
        </ReactFlow>
      </ReactFlowProvider>
      {fitNodes?.length ? <p className="pointer-events-none absolute bottom-3 left-4 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-muted">Drag to follow the flow ↓</p> : null}
      {children}
    </div>
  );
}
