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
  const envExamplePath = path.join(projectRoot, ".env.ga-dashboard.example");
  const oauthScriptPath = path.join(projectRoot, "scripts", "create-google-analytics-refresh-token.mjs");
  const files = new Map<string, string>();

  files.set(pagePath, dashboardPage(importPath(pagePath, componentPath), importPath(pagePath, configPath)));
  files.set(apiPath, apiRoute(importPath(apiPath, ga4Path)));
  files.set(componentPath, dashboardComponent());
  files.set(ga4Path, ga4Helper());
  files.set(configPath, configFile(audit));
  files.set(envExamplePath, envExampleFile());
  files.set(oauthScriptPath, oauthHelperScript());

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
      integrationCapabilities: audit.integrationCapabilities ?? null,
    },
    null,
    2,
  )} as const;
`;
}

function apiRoute(ga4Import: string): string {
  return `import { NextRequest, NextResponse } from "next/server";
import { fetchGa4DashboardData } from "${ga4Import}";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5 * 60 * 1000;

type CachedResponse = {
  key: string;
  expiresAt: number;
  data: unknown;
};

let dashboardCache: CachedResponse | null = null;

export async function GET(request: NextRequest) {
  const range = normalizeRange(request.nextUrl.searchParams.get("range"));
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const cacheKey = \`ga4:\${range}\`;

  if (!refresh && dashboardCache?.key === cacheKey && dashboardCache.expiresAt > Date.now()) {
    return NextResponse.json(dashboardCache.data);
  }

  try {
    const data = await fetchGa4DashboardData(range);
    dashboardCache = {
      key: cacheKey,
      expiresAt: Date.now() + CACHE_TTL_MS,
      data,
    };
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GA4 error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function normalizeRange(value: string | null): "today" | "yesterday" | "7d" | "30d" {
  if (value === "today" || value === "yesterday" || value === "30d") return value;
  return "7d";
}
`;
}

function ga4Helper(): string {
  return `import { BetaAnalyticsDataClient, type protos } from "@google-analytics/data";
import { GoogleAuth, OAuth2Client } from "google-auth-library";

const propertyId = process.env.GA4_PROPERTY_ID;

export type AnalyticsRange = "today" | "yesterday" | "7d" | "30d";

type DateRangeConfig = {
  range: AnalyticsRange;
  startDate: string;
  endDate: string;
  dimension: "date" | "dateHour";
  granularity: "hour" | "day";
};

const GA4_DATA_API_CONCURRENCY = parseConcurrency(process.env.GA4_DATA_API_CONCURRENCY, 2);
const GA4_QUOTA_RETRY_ATTEMPTS = 3;

let activeGa4Requests = 0;
const queuedGa4Requests: Array<() => void> = [];

export async function fetchGa4DashboardData(rangeValue: AnalyticsRange = "7d") {
  const dateRange = getDateRange(rangeValue);
  const missingConfig = getMissingConfigMessage();
  if (missingConfig) {
    return emptyDashboard(dateRange, missingConfig);
  }

  const client = createAnalyticsDataClient();
  const property = "properties/" + propertyId;
  const [timeseriesReport, countriesReport, pagesReport, channelsReport, browsersReport, devicesReport, eventsReport] = await Promise.all([
    runGa4Report(client, {
      property,
      dateRanges: [{ startDate: dateRange.startDate, endDate: dateRange.endDate }],
      dimensions: [{ name: dateRange.dimension }],
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "keyEvents" },
        { name: "screenPageViews" },
        { name: "bounceRate" },
        { name: "averageSessionDuration" },
      ],
      orderBys: [{ dimension: { dimensionName: dateRange.dimension } }],
    }),
    topDimensionReport(client, property, dateRange, ["country", "countryId"], [{ name: "activeUsers" }, { name: "sessions" }], 100),
    topDimensionReport(client, property, dateRange, "pagePath", [{ name: "screenPageViews" }, { name: "activeUsers" }], 250),
    topDimensionReport(client, property, dateRange, "sessionDefaultChannelGroup", [{ name: "activeUsers" }, { name: "sessions" }], 25),
    topDimensionReport(client, property, dateRange, "browser", [{ name: "activeUsers" }, { name: "sessions" }], 25),
    topDimensionReport(client, property, dateRange, "deviceCategory", [{ name: "activeUsers" }, { name: "sessions" }], 25),
    topDimensionReport(client, property, dateRange, "eventName", [{ name: "eventCount" }], 250),
  ]);

  const timeseriesRows = timeseriesReport[0].rows ?? [];
  const summary = summarizeTimeseries(timeseriesRows);

  return {
    configured: true,
    range: dateRange.range,
    granularity: dateRange.granularity,
    status: { ga4: "ok" },
    summary,
    timeseries: mergeTimeseries(dateRange, timeseriesRows),
    breakdowns: {
      countries: toTrafficBreakdown(countriesReport[0].rows),
      pages: toPageBreakdown(pagesReport[0].rows),
      channels: toTrafficBreakdown(channelsReport[0].rows),
      browsers: toTrafficBreakdown(browsersReport[0].rows),
      devices: toTrafficBreakdown(devicesReport[0].rows),
      events: toEventBreakdown(eventsReport[0].rows),
    },
  };
}

function createAnalyticsDataClient() {
  const oauthClient = createOauthClient();
  if (oauthClient) {
    return new BetaAnalyticsDataClient({
      auth: new GoogleAuth({ authClient: oauthClient }),
    });
  }

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

function createOauthClient() {
  const clientId = cleanEnv(process.env.GA4_CLIENT_ID);
  const clientSecret = cleanEnv(process.env.GA4_CLIENT_SECRET);
  const refreshToken = cleanEnv(process.env.GA4_REFRESH_TOKEN);
  if (!clientId || !clientSecret || !refreshToken) return null;

  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function getMissingConfigMessage(): string | null {
  if (!propertyId) return "Set GA4_PROPERTY_ID to enable live GA4 data.";
  const hasOauth = Boolean(cleanEnv(process.env.GA4_CLIENT_ID) && cleanEnv(process.env.GA4_CLIENT_SECRET) && cleanEnv(process.env.GA4_REFRESH_TOKEN));
  const hasServiceAccount = Boolean(cleanEnv(process.env.GA4_CLIENT_EMAIL) && cleanEnv(process.env.GA4_PRIVATE_KEY));
  if (!hasOauth && !hasServiceAccount) {
    return "Set GA4_CLIENT_ID, GA4_CLIENT_SECRET, and GA4_REFRESH_TOKEN. Service-account credentials are also supported with GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY.";
  }
  return null;
}

function getDateRange(value: AnalyticsRange): DateRangeConfig {
  if (value === "today") {
    return { range: "today", startDate: "today", endDate: "today", dimension: "dateHour", granularity: "hour" };
  }
  if (value === "yesterday") {
    return { range: "yesterday", startDate: "yesterday", endDate: "yesterday", dimension: "dateHour", granularity: "hour" };
  }
  if (value === "30d") {
    return { range: "30d", startDate: "29daysAgo", endDate: "today", dimension: "date", granularity: "day" };
  }
  return { range: "7d", startDate: "6daysAgo", endDate: "today", dimension: "date", granularity: "day" };
}

function topDimensionReport(
  client: BetaAnalyticsDataClient,
  property: string,
  dateRange: DateRangeConfig,
  dimensions: string | string[],
  metrics: Array<{ name: string }>,
  limit: number,
) {
  return runGa4Report(client, {
    property,
    dateRanges: [{ startDate: dateRange.startDate, endDate: dateRange.endDate }],
    dimensions: (Array.isArray(dimensions) ? dimensions : [dimensions]).map((name) => ({ name })),
    metrics,
    orderBys: [{ metric: { metricName: metrics[0].name }, desc: true }],
    limit,
  });
}

function runGa4Report(client: BetaAnalyticsDataClient, request: protos.google.analytics.data.v1beta.IRunReportRequest) {
  return scheduleGa4DataRequest(() => client.runReport(request));
}

function scheduleGa4DataRequest<T>(request: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeGa4Requests += 1;
      withGa4QuotaRetry(request)
        .then(resolve, reject)
        .finally(() => {
          activeGa4Requests -= 1;
          queuedGa4Requests.shift()?.();
        });
    };

    if (activeGa4Requests < GA4_DATA_API_CONCURRENCY) run();
    else queuedGa4Requests.push(run);
  });
}

async function withGa4QuotaRetry<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < GA4_QUOTA_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const isLastAttempt = attempt === GA4_QUOTA_RETRY_ATTEMPTS - 1;
      if (!isGa4QuotaError(error) || isLastAttempt) throw error;
      await sleep(500 * 2 ** attempt + Math.random() * 250);
    }
  }
  return request();
}

function isGa4QuotaError(error: unknown): boolean {
  const maybeError = error as { code?: number; message?: string };
  const message = String(maybeError?.message ?? error ?? "").toLowerCase();
  return maybeError?.code === 8 || message.includes("resource_exhausted") || message.includes("concurrent requests quota");
}

function summarizeTimeseries(rows: protos.google.analytics.data.v1beta.IRow[]) {
  let visitors = 0;
  let sessions = 0;
  let pageViews = 0;
  let keyEvents = 0;
  let weightedBounceRate = 0;
  let weightedSessionDuration = 0;

  for (const row of rows) {
    const rowVisitors = toNumber(row.metricValues?.[0]?.value);
    const rowSessions = toNumber(row.metricValues?.[1]?.value);
    visitors += rowVisitors;
    sessions += rowSessions;
    keyEvents += toNumber(row.metricValues?.[2]?.value);
    pageViews += toNumber(row.metricValues?.[3]?.value);
    weightedBounceRate += toRatePercent(row.metricValues?.[4]?.value) * rowSessions;
    weightedSessionDuration += toNumber(row.metricValues?.[5]?.value) * rowSessions;
  }

  return {
    visitors,
    sessions,
    pageViews,
    keyEvents,
    conversionRate: sessions > 0 ? (keyEvents / sessions) * 100 : 0,
    bounceRate: sessions > 0 ? weightedBounceRate / sessions : 0,
    avgSessionSeconds: sessions > 0 ? weightedSessionDuration / sessions : 0,
  };
}

function mergeTimeseries(dateRange: DateRangeConfig, rows: protos.google.analytics.data.v1beta.IRow[]) {
  const points = new Map(emptyTimeseries(dateRange).map((point) => [point.label, point]));

  for (const row of rows) {
    const label = formatDimensionLabel(row.dimensionValues?.[0]?.value, dateRange.granularity);
    points.set(label, {
      label,
      visitors: toNumber(row.metricValues?.[0]?.value),
      sessions: toNumber(row.metricValues?.[1]?.value),
      keyEvents: toNumber(row.metricValues?.[2]?.value),
      revenue: 0,
    });
  }

  return Array.from(points.values());
}

function emptyTimeseries(dateRange: DateRangeConfig) {
  if (dateRange.granularity === "hour") {
    return Array.from({ length: 24 }, (_, hour) => ({
      label: hour.toString().padStart(2, "0") + ":00",
      visitors: 0,
      sessions: 0,
      keyEvents: 0,
      revenue: 0,
    }));
  }

  const days = dateRange.range === "30d" ? 30 : 7;
  const now = new Date();
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (days - index - 1));
    return {
      label: date.toISOString().slice(0, 10),
      visitors: 0,
      sessions: 0,
      keyEvents: 0,
      revenue: 0,
    };
  });
}

function toTrafficBreakdown(rows: protos.google.analytics.data.v1beta.IRow[] | null | undefined) {
  return (
    rows?.map((row) => ({
      name: row.dimensionValues?.[0]?.value || "Unknown",
      code: row.dimensionValues?.[1]?.value || undefined,
      visitors: toNumber(row.metricValues?.[0]?.value),
      sessions: toNumber(row.metricValues?.[1]?.value),
      revenue: 0,
    })) ?? []
  );
}

function toPageBreakdown(rows: protos.google.analytics.data.v1beta.IRow[] | null | undefined) {
  return (
    rows?.map((row) => ({
      name: row.dimensionValues?.[0]?.value || "Unknown",
      pageViews: toNumber(row.metricValues?.[0]?.value),
      visitors: toNumber(row.metricValues?.[1]?.value),
    })) ?? []
  );
}

function toEventBreakdown(rows: protos.google.analytics.data.v1beta.IRow[] | null | undefined) {
  return (
    rows?.map((row) => ({
      name: row.dimensionValues?.[0]?.value || "Unknown",
      visitors: toNumber(row.metricValues?.[0]?.value),
    })) ?? []
  );
}

function emptyDashboard(dateRange: DateRangeConfig, message: string) {
  return {
    configured: false,
    range: dateRange.range,
    granularity: dateRange.granularity,
    status: { ga4: "missing_config", message },
    summary: {
      visitors: 0,
      sessions: 0,
      pageViews: 0,
      keyEvents: 0,
      conversionRate: 0,
      bounceRate: 0,
      avgSessionSeconds: 0,
    },
    timeseries: emptyTimeseries(dateRange),
    breakdowns: {
      countries: [],
      pages: [],
      channels: [],
      browsers: [],
      devices: [],
      events: [],
    },
  };
}

function formatDimensionLabel(value: string | null | undefined, granularity: "hour" | "day"): string {
  if (!value) return "";
  if (granularity === "hour") return value.slice(-2) + ":00";
  if (value.length === 8) return value.slice(0, 4) + "-" + value.slice(4, 6) + "-" + value.slice(6, 8);
  return value;
}

function parseConcurrency(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 8);
}

function cleanEnv(value: string | undefined): string | undefined {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");
  return cleaned || undefined;
}

function toNumber(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toRatePercent(value: string | null | undefined): number {
  const parsed = toNumber(value);
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`;
}

function dashboardComponent(): string {
  return `"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, RefreshCw } from "lucide-react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

type AnalyticsRange = "today" | "yesterday" | "7d" | "30d";

type Summary = {
  visitors: number;
  sessions: number;
  pageViews: number;
  keyEvents: number;
  conversionRate: number;
  bounceRate: number;
  avgSessionSeconds: number;
};

type TimeseriesPoint = {
  label: string;
  visitors: number;
  sessions: number;
  keyEvents: number;
  revenue?: number;
};

type BreakdownRow = {
  name: string;
  code?: string;
  visitors: number;
  sessions?: number;
  pageViews?: number;
  revenue?: number;
};

type ApiData = {
  configured?: boolean;
  range?: AnalyticsRange;
  granularity?: "hour" | "day";
  status?: { ga4?: string; message?: string };
  summary?: Summary;
  timeseries?: TimeseriesPoint[];
  breakdowns?: {
    countries: BreakdownRow[];
    pages: BreakdownRow[];
    channels: BreakdownRow[];
    browsers: BreakdownRow[];
    devices: BreakdownRow[];
    events: BreakdownRow[];
  };
  error?: string;
};

const rangeLabels: Record<AnalyticsRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "7 days",
  "30d": "30 days",
};

const rangeOptions: AnalyticsRange[] = ["today", "yesterday", "7d", "30d"];

const emptySummary: Summary = {
  visitors: 0,
  sessions: 0,
  pageViews: 0,
  keyEvents: 0,
  conversionRate: 0,
  bounceRate: 0,
  avgSessionSeconds: 0,
};

export function AnalyticsDashboard({ config }: { config: DashboardConfig }) {
  const [range, setRange] = useState<AnalyticsRange>("yesterday");
  const [data, setData] = useState<ApiData>({});
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback((refresh = false) => {
    setLoading(true);
    fetch("/api/ga-dashboard?range=" + range + (refresh ? "&refresh=1" : ""), {
      credentials: "include",
      cache: "no-store",
    })
      .then((response) => response.json())
      .then(setData)
      .catch((error) => setData({ error: error instanceof Error ? error.message : "Failed to load GA4 data" }))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const summary = data.summary ?? emptySummary;
  const timeseries = data.timeseries ?? [];
  const breakdowns = {
    countries: [],
    pages: [],
    channels: [],
    browsers: [],
    devices: [],
    events: [],
    ...(data.breakdowns ?? {}),
  };
  const warning = data.error || data.status?.message;
  const generatedFunnels = useMemo(() => config.funnels.slice(0, 4), [config.funnels]);

  return (
    <section className="min-h-screen bg-[#151515] text-zinc-100">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#242424] px-3 py-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0f0f0f] text-xs font-black text-[#9ed0ff]">GA</div>
              <span className="font-semibold text-zinc-100">Analytics</span>
            </div>
            <div className="flex overflow-hidden rounded-lg border border-white/10 bg-[#242424]">
              {rangeOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  className={range === option ? "bg-white/10 px-4 py-2 text-sm font-semibold text-white" : "px-4 py-2 text-sm font-semibold text-zinc-500 hover:text-zinc-200"}
                >
                  {rangeLabels[option]}
                </button>
              ))}
            </div>
            <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#242424] text-zinc-300" aria-label="Filter analytics">
              <Filter className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => loadDashboard(true)}
              disabled={loading}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#242424] text-zinc-300 disabled:opacity-60"
              aria-label="Refresh analytics"
            >
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </button>
          </div>
          <div className="text-sm text-zinc-500">{data.granularity === "hour" ? "Hourly" : "Daily"} view</div>
        </header>

        {warning ? <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{warning}</div> : null}

        <Panel className="overflow-hidden">
          <div className="grid md:grid-cols-4 xl:grid-cols-8">
            <Kpi label="Visitors" value={formatNumber(summary.visitors)} detail="GA4 active users" active />
            <Kpi label="Sessions" value={formatNumber(summary.sessions)} detail="GA4 sessions" />
            <Kpi label="Page views" value={formatNumber(summary.pageViews)} detail="screen page views" />
            <Kpi label="Key events" value={formatNumber(summary.keyEvents)} detail={formatCompact(summary.conversionRate) + "% of sessions"} />
            <Kpi label="Bounce rate" value={formatCompact(summary.bounceRate) + "%"} detail="weighted by sessions" />
            <Kpi label="Session time" value={formatDuration(summary.avgSessionSeconds)} detail="average" />
            <Kpi label="Funnels" value={formatNumber(generatedFunnels.length)} detail="from audit" />
            <Kpi label="Events found" value={formatNumber(config.recommendedEvents.length)} detail="recommended" />
          </div>
          <div className="h-[420px] border-t border-white/10 px-2 pt-5">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timeseries} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <defs>
                  <linearGradient id="visitorArea" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#9ed0ff" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#9ed0ff" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#777"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={data.granularity === "day" ? 46 : 22}
                  tickFormatter={(value) => formatChartTick(String(value), data.granularity)}
                />
                <YAxis yAxisId="left" stroke="#777" tickLine={false} axisLine={false} width={40} />
                <YAxis yAxisId="right" orientation="right" stroke="#777" tickLine={false} axisLine={false} width={48} />
                <Tooltip content={<ChartTooltip />} />
                <Area yAxisId="left" type="monotone" dataKey="visitors" stroke="none" fill="url(#visitorArea)" />
                <Line yAxisId="left" type="monotone" dataKey="visitors" stroke="#9ed0ff" strokeWidth={3} dot={false} />
                <Bar yAxisId="right" dataKey="keyEvents" fill="#4f79ff" radius={[5, 5, 0, 0]} barSize={28} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <div className="grid gap-5 xl:grid-cols-2">
          <RankedPanel title="Country" metricLabel="Visitors" rows={breakdowns.countries} showRevenueBars />
          <RankedPanel title="Browser" metricLabel="Visitors" rows={breakdowns.browsers} />
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <RankedPanel title="Channel" metricLabel="Visitors" rows={breakdowns.channels} />
          <RankedPanel title="Page" metricLabel="Views" rows={breakdowns.pages} pageMode />
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <GoalPanel rows={breakdowns.events} />
          <FunnelPanel funnels={generatedFunnels} />
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, detail, active }: { label: string; value: string; detail: string; active?: boolean }) {
  return (
    <div className="min-h-[116px] border-white/10 px-5 py-4 md:border-r">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-400">
        <span className={active ? "h-4 w-4 rounded bg-[#8fc8ff]" : "h-4 w-4 rounded bg-white/10"} />
        {label}
      </div>
      <div className="mt-3 text-3xl font-bold text-zinc-100">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{detail}</div>
    </div>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={"rounded-lg border border-white/10 bg-[#242424] shadow-2xl shadow-black/20 " + className}>{children}</section>
  );
}

function RankedPanel({
  title,
  metricLabel,
  rows,
  pageMode,
  showRevenueBars,
}: {
  title: string;
  metricLabel: string;
  rows: BreakdownRow[];
  pageMode?: boolean;
  showRevenueBars?: boolean;
}) {
  const maxPrimary = Math.max(...rows.map((row) => (pageMode ? row.pageViews ?? row.visitors : row.visitors)), 1);
  const maxRevenue = Math.max(...rows.map((row) => row.revenue ?? 0), 1);
  const visibleRows = rows.slice(0, 10);

  return (
    <Panel>
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="text-sm font-bold text-zinc-100">{title}</div>
        <span className="text-sm font-bold text-zinc-300">{metricLabel} <span className="text-zinc-500">sort</span></span>
      </div>
      <div className="min-h-[360px] p-4">
        {visibleRows.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-500">No data for this range.</div>
        ) : (
          <div className="space-y-1">
            {visibleRows.map((row) => {
              const primary = pageMode ? row.pageViews ?? row.visitors : row.visitors;
              const primaryWidth = Math.max((primary / maxPrimary) * 100, primary > 0 ? 5 : 0);
              const revenueWidth = showRevenueBars && (row.revenue ?? 0) > 0 ? Math.max(((row.revenue ?? 0) / maxRevenue) * 100, 5) : 0;

              return (
                <div key={row.name} className="group relative h-12 overflow-visible rounded-md">
                  <div className="absolute inset-y-0 left-0 overflow-hidden rounded-md" style={{ width: Math.min(Math.max(primaryWidth, revenueWidth), 100) + "%" }}>
                    <div className="absolute inset-y-0 left-0 rounded-l-md bg-[#3f5f78]" style={{ width: Math.min(primaryWidth, 100) + "%" }} />
                    {revenueWidth > 0 ? <div className="absolute inset-y-0 right-0 rounded-r-md bg-[#283a91]" style={{ width: Math.min(revenueWidth, 100) + "%" }} /> : null}
                  </div>
                  <div className="relative z-10 grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3">
                    <span className="min-w-0 truncate text-sm font-bold text-zinc-100">{rowIcon(row)}{row.name}</span>
                    <span className="shrink-0 text-sm font-bold text-zinc-100">{formatNumber(primary)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}

function GoalPanel({ rows }: { rows: BreakdownRow[] }) {
  const visibleRows = rows.slice(0, 12);
  const maxCount = Math.max(...visibleRows.map((row) => row.visitors), 1);

  return (
    <Panel>
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="text-sm font-bold text-zinc-100">Goals</div>
        <span className="text-sm font-bold text-zinc-300">Events</span>
      </div>
      <div className="min-h-[360px] p-4">
        {visibleRows.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-500">No GA events for this range.</div>
        ) : (
          <div className="space-y-1">
            {visibleRows.map((row) => (
              <div key={row.name} className="relative h-12 overflow-hidden rounded-md">
                <div className="absolute inset-y-0 left-0 rounded-md bg-[#435f78]" style={{ width: Math.max((row.visitors / maxCount) * 100, 4) + "%" }} />
                <div className="relative z-10 grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4">
                  <span className="min-w-0 truncate text-sm font-bold text-zinc-100">{row.name}</span>
                  <span className="shrink-0 text-sm font-bold text-zinc-200">{formatNumber(row.visitors)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function FunnelPanel({ funnels }: { funnels: DashboardConfig["funnels"] }) {
  return (
    <Panel>
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="text-sm font-bold text-zinc-100">Funnels</div>
        <span className="text-sm font-bold text-zinc-300">Audit</span>
      </div>
      <div className="min-h-[360px] p-4">
        {funnels.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-500">No funnels were generated from the audit.</div>
        ) : (
          <div className="space-y-4">
            {funnels.map((funnel) => (
              <div key={funnel.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                <div className="text-sm font-bold text-white">{funnel.name}</div>
                <div className="mt-3 grid gap-2">
                  {funnel.steps.map((step, index) => (
                    <div key={step.eventName + index} className="flex items-center gap-3 text-sm">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10 text-xs font-bold">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-zinc-300">{step.name}</span>
                      <code className="shrink-0 rounded bg-black/30 px-2 py-1 text-xs text-[#9ed0ff]">{step.eventName}</code>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#4a4a4a] p-4 text-sm shadow-xl">
      <div className="mb-2 font-bold text-white">{label}</div>
      {payload.map((item) => (
        <div key={item.name} className="flex items-center justify-between gap-5 text-zinc-200">
          <span>{item.name}</span>
          <span className="font-bold">{formatNumber(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

function rowIcon(row: BreakdownRow): string {
  if (!row.code || !/^[A-Z]{2}$/.test(row.code.toUpperCase())) return "";
  return String.fromCodePoint(...row.code.toUpperCase().split("").map((char) => 127397 + char.charCodeAt(0))) + " ";
}

function formatNumber(value: number): string {
  return Math.round(value || 0).toLocaleString();
}

function formatCompact(value: number): string {
  return Number.isFinite(value) ? value.toFixed(value >= 10 ? 0 : 1) : "0";
}

function formatDuration(seconds: number): string {
  if (!seconds) return "0s";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return minutes > 0 ? minutes + "m " + remaining + "s" : remaining + "s";
}

function formatChartTick(value: string, granularity?: "hour" | "day"): string {
  if (granularity !== "day") return value;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !part)) return value;
  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "long" }).format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])));
}
`;
}

function envExampleFile(): string {
  return `# Next GA4 Dashboard server-side environment variables.
# Copy the values you need into .env.local and your deployment provider.

GA4_PROPERTY_ID=
GA4_CLIENT_ID=
GA4_CLIENT_SECRET=
GA4_REFRESH_TOKEN=

# Optional: only needed when you also want Search Console keyword rows.
# Use sc-domain:example.com for a Domain property, or the exact URL-prefix property.
GSC_SITE_URL=

# Optional: reduce GA4 Data API concurrent report pressure.
GA4_DATA_API_CONCURRENCY=2

# Optional: only needed if you extend the generated route with Stripe revenue.
# Never expose this as NEXT_PUBLIC_*.
STRIPE_SECRET_KEY=
ANALYTICS_REVENUE_CURRENCY=usd

# Optional service-account fallback. OAuth is recommended because many Google Cloud orgs block key creation.
GA4_CLIENT_EMAIL=
GA4_PRIVATE_KEY=
`;
}

function oauthHelperScript(): string {
  return `#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFileSync, existsSync } from "node:fs";

loadLocalEnv();

const clientId = clean(process.env.GA4_CLIENT_ID);
const clientSecret = clean(process.env.GA4_CLIENT_SECRET);
const redirectUri = clean(process.env.GA4_OAUTH_REDIRECT_URI) || "http://localhost:3000/api/auth/google/callback";
const scopes = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

if (!clientId || !clientSecret) {
  console.error("Set GA4_CLIENT_ID and GA4_CLIENT_SECRET in .env.local first.");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");
authUrl.searchParams.set("scope", scopes.join(" "));

console.log("");
console.log("Open this URL with the Google account that can read the GA4 property:");
console.log(authUrl.toString());
console.log("");
console.log("After Google redirects you, paste the full callback URL or just the code= value.");
console.log("The refresh token goes into GA4_REFRESH_TOKEN.");
console.log("");

const rl = createInterface({ input, output });
const answer = await rl.question("Callback URL or code: ");
rl.close();

const code = extractCode(answer.trim());
if (!code) {
  console.error("Could not find an authorization code.");
  process.exit(1);
}

const response = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  }),
});

const payload = await response.json().catch(() => null);
if (!response.ok || !payload?.refresh_token) {
  console.error("Google did not return a refresh token.");
  console.error(JSON.stringify(payload, null, 2));
  console.error("");
  console.error("Common fixes:");
  console.error("- Use the same OAuth client id and secret as .env.local.");
  console.error("- Make sure the redirect URI exactly matches Google Cloud.");
  console.error("- Keep prompt=consent and access_type=offline.");
  console.error("- Add your Google account as a test user if the consent screen is in testing.");
  process.exit(1);
}

console.log("");
console.log("Add this to .env.local and your deployment provider:");
console.log("GA4_REFRESH_TOKEN=" + payload.refresh_token);
if (payload.scope) {
  console.log("");
  console.log("Granted scopes:");
  console.log(String(payload.scope).split(" ").map((scope) => "- " + scope).join("\\n"));
}

function extractCode(value) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.searchParams.get("code") || "";
  } catch {
    return value.replace(/^code=/, "");
  }
}

function clean(value) {
  const cleaned = String(value || "").trim().replace(/^['"]|['"]$/g, "");
  return cleaned || undefined;
}

function loadLocalEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\\r?\\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}
`;
}

function importPath(fromFile: string, toFile: string): string {
  const relative = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, "/").replace(/\.(tsx|ts)$/, "");
  return relative.startsWith(".") ? relative : `./${relative}`;
}
