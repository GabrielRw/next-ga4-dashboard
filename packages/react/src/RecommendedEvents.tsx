"use client";

import type { GaRecommendedEvent } from "./types.js";

export function RecommendedEvents({ events, limit = 8 }: { events: GaRecommendedEvent[]; limit?: number }) {
  return (
    <div className="space-y-3">
      {events.slice(0, limit).map((event) => (
        <div key={event.name} className="rounded border border-zinc-800 p-3">
          <code className="text-xs text-emerald-300">{event.name}</code>
          <div className="mt-1 text-sm text-zinc-300">{event.label}</div>
          <div className="mt-1 truncate text-xs text-zinc-500">{event.file}</div>
        </div>
      ))}
    </div>
  );
}
