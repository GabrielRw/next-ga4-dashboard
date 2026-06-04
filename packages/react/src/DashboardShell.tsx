"use client";

import type { ReactNode } from "react";

export function DashboardShell({ children, status }: { children: ReactNode; status?: ReactNode }) {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-2 border-b border-zinc-800 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Analytics</h1>
            <p className="mt-1 text-sm text-zinc-400">Self-hosted GA4 dashboard.</p>
          </div>
          {status ? <div className="rounded border border-zinc-800 px-3 py-2 text-xs text-zinc-400">{status}</div> : null}
        </header>
        {children}
      </div>
    </main>
  );
}
