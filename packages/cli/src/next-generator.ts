import { promises as fs } from "node:fs";
import path from "node:path";
import { Audit } from "@next-ga4-dashboard/core";

export async function generateNextDashboard(projectRoot: string, audit: Audit, route: string): Promise<string[]> {
  const normalizedRoute = route.replace(/^\/+|\/+$/g, "") || "admin/analytics";
  const pagePath = path.join(projectRoot, "app", normalizedRoute, "page.tsx");
  const apiPath = path.join(projectRoot, "app", "api", "ga-dashboard", "route.ts");
  const componentPath = path.join(projectRoot, "components", "ga-dashboard", "AnalyticsDashboard.tsx");
  const ga4Path = path.join(projectRoot, "lib", "ga-dashboard", "ga4.ts");
  const configPath = path.join(projectRoot, "lib", "ga-dashboard", "config.ts");
  const files = new Map<string, string>();

  files.set(pagePath, dashboardPage(importPath(pagePath, componentPath), importPath(pagePath, configPath)));
  files.set(apiPath, apiRoute(importPath(apiPath, ga4Path)));
  files.set(componentPath, dashboardComponent());
  files.set(ga4Path, ga4Helper());
  files.set(configPath, configFile(audit));

  const written: string[] = [];
  for (const [filePath, content] of files) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    written.push(filePath);
  }
  return written;
}

function dashboardPage(componentImport: string, configImport: string): string {
  return `import { AnalyticsDashboard } from "${componentImport}";
import { gaDashboardConfig } from "${configImport}";

export default function AnalyticsPage() {
  return <AnalyticsDashboard config={gaDashboardConfig} />;
}
`;
}

function configFile(audit: Audit): string {
  return `export const gaDashboardConfig = ${JSON.stringify(
    {
      generatedAt: audit.generatedAt,
      widgets: audit.dashboardWidgets,
      funnels: audit.suggestedFunnels,
      detectedEvents: audit.detectedEvents.map((event) => event.name),
      recommendedEvents: audit.missingRecommendedEvents.map((event) => ({
        name: event.suggestedEventName,
        label: event.label,
        file: event.file,
        reason: event.reason,
      })),
    },
    null,
    2,
  )} as const;
`;
}

function apiRoute(ga4Import: string): string {
  return `import { NextResponse } from "next/server";
import { fetchGa4DashboardData } from "${ga4Import}";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchGa4DashboardData();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GA4 error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
`;
}

function ga4Helper(): string {
  return `import { BetaAnalyticsDataClient } from "@google-analytics/data";

const propertyId = process.env.GA4_PROPERTY_ID;

export async function fetchGa4DashboardData() {
  if (!propertyId) {
    return {
      configured: false,
      metrics: [],
      rows: [],
      message: "Set GA4_PROPERTY_ID and Google service account credentials to enable live GA4 data.",
    };
  }

  const client = createAnalyticsDataClient();
  const [report] = await client.runReport({
    property: \`properties/\${propertyId}\`,
    dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
    dimensions: [{ name: "date" }],
    metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "keyEvents" }],
  });

  return {
    configured: true,
    metrics: report.metricHeaders?.map((metric) => metric.name) ?? [],
    rows:
      report.rows?.map((row) => ({
        date: row.dimensionValues?.[0]?.value,
        activeUsers: Number(row.metricValues?.[0]?.value ?? 0),
        sessions: Number(row.metricValues?.[1]?.value ?? 0),
        keyEvents: Number(row.metricValues?.[2]?.value ?? 0),
      })) ?? [],
  };
}

function createAnalyticsDataClient() {
  const clientEmail = process.env.GA4_CLIENT_EMAIL;
  const privateKey = process.env.GA4_PRIVATE_KEY?.replace(/\\\\n/g, "\\n");

  if (clientEmail && privateKey) {
    return new BetaAnalyticsDataClient({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
    });
  }

  return new BetaAnalyticsDataClient();
}
`;
}

function dashboardComponent(): string {
  return `"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type DashboardConfig = {
  widgets: readonly { id: string; title: string; type: string; eventName?: string; metric?: string }[];
  funnels: readonly {
    id: string;
    name: string;
    description: string;
    steps: readonly { name: string; eventName: string; description: string }[];
  }[];
  recommendedEvents: readonly { name: string; label: string; file: string; reason: string }[];
};

type ApiData = {
  configured?: boolean;
  message?: string;
  rows?: Array<{ date?: string; activeUsers: number; sessions: number; keyEvents: number }>;
  error?: string;
};

export function AnalyticsDashboard({ config }: { config: DashboardConfig }) {
  const [data, setData] = useState<ApiData>({});

  useEffect(() => {
    fetch("/api/ga-dashboard")
      .then((response) => response.json())
      .then(setData)
      .catch((error) => setData({ error: error instanceof Error ? error.message : "Failed to load GA4 data" }));
  }, []);

  const rows = data.rows ?? [];
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          activeUsers: acc.activeUsers + row.activeUsers,
          sessions: acc.sessions + row.sessions,
          keyEvents: acc.keyEvents + row.keyEvents,
        }),
        { activeUsers: 0, sessions: 0, keyEvents: 0 },
      ),
    [rows],
  );

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-2 border-b border-zinc-800 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Analytics</h1>
            <p className="mt-1 text-sm text-zinc-400">Self-hosted GA4 dashboard generated by Next GA4 Dashboard.</p>
          </div>
          <div className="rounded border border-zinc-800 px-3 py-2 text-xs text-zinc-400">
            {data.configured === false ? data.message : data.error ? data.error : "GA4 live data"}
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <Metric title="Active users" value={totals.activeUsers} />
          <Metric title="Sessions" value={totals.sessions} />
          <Metric title="Key events" value={totals.keyEvents} />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Panel title="Sessions">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={rows}>
                <CartesianGrid stroke="#27272a" vertical={false} />
                <XAxis dataKey="date" stroke="#a1a1aa" tickLine={false} axisLine={false} />
                <YAxis stroke="#a1a1aa" tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", color: "#f4f4f5" }} />
                <Line type="monotone" dataKey="sessions" stroke="#38bdf8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Key events">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={rows}>
                <CartesianGrid stroke="#27272a" vertical={false} />
                <XAxis dataKey="date" stroke="#a1a1aa" tickLine={false} axisLine={false} />
                <YAxis stroke="#a1a1aa" tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", color: "#f4f4f5" }} />
                <Bar dataKey="keyEvents" fill="#22c55e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Panel title="Funnels">
            <div className="space-y-5">
              {config.funnels.map((funnel) => (
                <div key={funnel.id} className="border-b border-zinc-800 pb-4 last:border-0 last:pb-0">
                  <div className="text-sm font-medium">{funnel.name}</div>
                  <div className="mt-2 grid gap-2">
                    {funnel.steps.map((step, index) => (
                      <div key={step.eventName} className="flex items-center gap-3 text-sm">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-zinc-800 text-xs">{index + 1}</span>
                        <span className="text-zinc-300">{step.name}</span>
                        <code className="ml-auto rounded bg-zinc-900 px-2 py-1 text-xs text-sky-300">{step.eventName}</code>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Recommended events">
            <div className="space-y-3">
              {config.recommendedEvents.slice(0, 8).map((event) => (
                <div key={event.name} className="rounded border border-zinc-800 p-3">
                  <code className="text-xs text-emerald-300">{event.name}</code>
                  <div className="mt-1 text-sm text-zinc-300">{event.label}</div>
                  <div className="mt-1 truncate text-xs text-zinc-500">{event.file}</div>
                </div>
              ))}
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="text-sm text-zinc-400">{title}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/50 p-4">
      <h2 className="mb-4 text-sm font-medium text-zinc-200">{title}</h2>
      {children}
    </div>
  );
}
`;
}

function importPath(fromFile: string, toFile: string): string {
  const relative = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, "/").replace(/\.(tsx|ts)$/, "");
  return relative.startsWith(".") ? relative : `./${relative}`;
}
