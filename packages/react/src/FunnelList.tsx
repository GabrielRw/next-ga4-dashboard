"use client";

import type { GaDashboardFunnel } from "./types.js";

export function FunnelList({ funnels }: { funnels: GaDashboardFunnel[] }) {
  return (
    <div className="space-y-5">
      {funnels.map((funnel) => (
        <div key={funnel.id} className="border-b border-zinc-800 pb-4 last:border-0 last:pb-0">
          <div className="text-sm font-medium">{funnel.name}</div>
          <div className="mt-2 grid gap-2">
            {funnel.steps.map((step, index) => (
              <div key={`${funnel.id}-${step.eventName}`} className="flex items-center gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-zinc-800 text-xs">{index + 1}</span>
                <span className="text-zinc-300">{step.name}</span>
                <code className="ml-auto rounded bg-zinc-900 px-2 py-1 text-xs text-sky-300">{step.eventName}</code>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
