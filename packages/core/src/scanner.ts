import { promises as fs } from "node:fs";
import path from "node:path";
import {
  Audit,
  AuditContext,
  DashboardWidget,
  DetectedEvent,
  Funnel,
  IntegrationCapabilities,
  RouteInfo,
  UIAction,
  auditContextSchema,
  auditSchema,
} from "./schemas.js";
import { listSourceFiles, packageManagerFromLockfiles, readJsonFile, toPosixRelative } from "./fs-utils.js";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const ANALYTICS_PATTERNS = [
  "gtag(",
  "dataLayer.push(",
  "track(",
  "analytics.track(",
  "sendGAEvent(",
  "GoogleAnalytics",
  "trackDataFastGoal(",
  "data-fast-goal",
  "NEXT_PUBLIC_GA",
  "NEXT_PUBLIC_GTM",
  "event_name",
  "eventName",
];

const IMPORTANT_FILE_PATTERNS = [
  /(^|\/)(page|layout)\.(tsx|jsx|ts|js|mdx?)$/,
  /pricing/i,
  /signup|sign-up|register|login|auth/i,
  /checkout|payment|billing/i,
  /dashboard|admin/i,
  /docs|documentation|api/i,
  /analytics|gtag|gtm|segment|posthog/i,
  /onboarding/i,
];

export async function scanProject(projectRoot: string): Promise<AuditContext> {
  const root = path.resolve(projectRoot);
  const packageJson = await readJsonFile<PackageJson>(path.join(root, "package.json"));
  const dependencies = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
  const sourceFiles = await listSourceFiles(root);
  const fileContents = await Promise.all(
    sourceFiles.map(async (file) => ({
      absolute: file,
      relative: toPosixRelative(root, file),
      text: await fs.readFile(file, "utf8"),
    })),
  );

  const routes = detectRoutes(root, fileContents.map((file) => file.absolute));
  const analytics = detectAnalytics(fileContents, dependencies);
  const integrationCapabilities = detectIntegrationCapabilities(fileContents, dependencies, routes);
  const detectedEvents = detectEvents(fileContents);
  const uiActions = detectUiActions(fileContents, detectedEvents);
  const suggestedFunnels = suggestFunnels(routes, uiActions, detectedEvents);
  const dashboardWidgets = suggestDashboardWidgets(detectedEvents, uiActions, suggestedFunnels);
  const importantFiles = fileContents
    .filter((file) => IMPORTANT_FILE_PATTERNS.some((pattern) => pattern.test(file.relative)))
    .map((file) => file.relative)
    .slice(0, 60);

  const context: AuditContext = {
    version: "0.1",
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    framework: inferFramework(dependencies, routes),
    packageManager: await packageManagerFromLockfiles(root),
    dependencies,
    analytics,
    routes,
    importantFiles,
    detectedEvents,
    detectedForms: uiActions.filter((action) => action.kind === "form"),
    detectedButtons: uiActions.filter((action) => action.kind === "button"),
    detectedLinks: uiActions.filter((action) => action.kind === "link"),
    possibleConversionPoints: uiActions.filter((action) => action.confidence >= 0.74),
    possiblePaymentCheckoutFlows: uiActions.filter((action) => /checkout|payment|billing|subscribe|plan|cart/i.test(`${action.label} ${action.file}`)),
    possibleOnboardingFlows: uiActions.filter((action) => /signup|sign-up|register|onboarding|create account|start/i.test(`${action.label} ${action.file}`)),
    possibleDocsApiProductFlows: uiActions.filter((action) => /docs|api|copy|search|key|token/i.test(`${action.label} ${action.file}`)),
    missingRecommendedEvents: uiActions.filter((action) => !detectedEvents.some((event) => event.name === action.suggestedEventName)),
    suggestedFunnels,
    dashboardWidgets,
    integrationCapabilities,
    appTypeInference: inferAppType(routes, uiActions, dependencies),
  };

  return auditContextSchema.parse(context);
}

export function compactAudit(context: AuditContext): Audit {
  return auditSchema.parse({
    version: context.version,
    generatedAt: context.generatedAt,
    projectRoot: context.projectRoot,
    framework: context.framework,
    packageManager: context.packageManager,
    analytics: context.analytics,
    routes: context.routes,
    detectedEvents: context.detectedEvents,
    missingRecommendedEvents: context.missingRecommendedEvents,
    suggestedFunnels: context.suggestedFunnels,
    dashboardWidgets: context.dashboardWidgets,
    integrationCapabilities: context.integrationCapabilities,
  });
}

function detectRoutes(root: string, files: string[]): RouteInfo[] {
  return files.flatMap<RouteInfo>((file) => {
    const relative = toPosixRelative(root, file);
    const appMatch = relative.match(/^app\/(.+\/)?page\.(tsx|jsx|ts|js|mdx)$/);
    if (appMatch) return [{ path: routePathFromAppPage(relative), file: relative, type: "app" as const }];
    const pagesMatch = relative.match(/^pages\/(.+)\.(tsx|jsx|ts|js|mdx)$/);
    if (pagesMatch && !relative.startsWith("pages/api/")) {
      return [{ path: routePathFromPages(relative), file: relative, type: "pages" as const }];
    }
    return [];
  });
}

function routePathFromAppPage(relative: string): string {
  const withoutPrefix = relative.replace(/^app\//, "").replace(/\/page\.(tsx|jsx|ts|js|mdx)$/, "");
  const route = withoutPrefix
    .replace(/^page\.(tsx|jsx|ts|js|mdx)$/, "")
    .replace(/\([^)]*\)\//g, "")
    .replace(/\[[.]{3}(.+?)\]/g, ":$1*")
    .replace(/\[(.+?)\]/g, ":$1");
  return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function routePathFromPages(relative: string): string {
  const route = relative
    .replace(/^pages\//, "")
    .replace(/\.(tsx|jsx|ts|js|mdx)$/, "")
    .replace(/\/index$/, "")
    .replace(/^index$/, "")
    .replace(/\[[.]{3}(.+?)\]/g, ":$1*")
    .replace(/\[(.+?)\]/g, ":$1");
  return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function detectAnalytics(files: Array<{ relative: string; text: string }>, dependencies: Record<string, string>) {
  const joined = files.map((file) => file.text).join("\n");
  const libraries = Object.keys(dependencies).filter((name) =>
    /@next\/third-parties|@google-analytics|gtag|react-ga|analytics|segment|posthog|mixpanel|datafast/i.test(name),
  );
  if (/datafast|trackDataFastGoal|data-fast-goal/i.test(joined) && !libraries.includes("datafast")) {
    libraries.push("datafast");
  }
  return {
    libraries,
    gaMeasurementIds: uniqueMatches(joined, /G-[A-Z0-9]{6,}/g),
    gtmContainerIds: uniqueMatches(joined, /GTM-[A-Z0-9]{4,}/g),
    hasPageViewTracking: /page_view|config['"],\s*['"]G-|sendGAEvent\(\s*['"]page_view/i.test(joined),
  };
}

function detectIntegrationCapabilities(
  files: Array<{ relative: string; text: string }>,
  dependencies: Record<string, string>,
  routes: RouteInfo[],
): IntegrationCapabilities {
  const joined = files.map((file) => `${file.relative}\n${file.text}`).join("\n");
  const dependencyNames = Object.keys(dependencies).join("\n");
  const routePaths = routes.map((route) => route.path).join("\n");

  return {
    hasDataFast: /datafast|trackDataFastGoal|data-fast-goal/i.test(`${joined}\n${dependencyNames}`),
    hasStripe: /stripe|checkout\.session\.completed|STRIPE_SECRET_KEY|createCheckoutSession/i.test(`${joined}\n${dependencyNames}`),
    hasSupabase: /supabase|@supabase\/supabase-js/i.test(`${joined}\n${dependencyNames}`),
    hasAdminArea: /(^|\/)admin(\/|$)|admin\/dashboard|verify_admin|admin_token/i.test(`${joined}\n${routePaths}`),
    hasBackendApiRoutes: /app\/api\/|pages\/api\/|api\/v1|fastapi|express|route\.ts/i.test(joined),
    hasFirstPartyAttribution: /visitor_id|session_id|landing_page|utm_source|marketing_(signup|payment)_attributions|firstPartyAttribution/i.test(joined),
  };
}

function detectEvents(files: Array<{ relative: string; text: string }>): DetectedEvent[] {
  const events: DetectedEvent[] = [];
  for (const file of files) {
    const lines = file.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const eventNames = [
        ...uniqueMatches(line, /gtag\(\s*['"]event['"]\s*,\s*['"]([^'"]+)['"]/g, 1),
        ...uniqueMatches(line, /sendGAEvent\(\s*['"]([^'"]+)['"]/g, 1),
        ...uniqueMatches(line, /trackDataFastGoal\(\s*['"]([^'"]+)['"]/g, 1),
        ...uniqueMatches(line, /window\.datafast\(\s*['"]([^'"]+)['"]/g, 1),
        ...uniqueMatches(line, /analytics\.track\(\s*['"]([^'"]+)['"]/g, 1),
        ...uniqueMatches(line, /track\(\s*['"]([^'"]+)['"]/g, 1),
        ...uniqueMatches(line, /event_?name['"]?\s*:\s*['"]([^'"]+)['"]/gi, 1),
      ];
      for (const name of eventNames) {
        events.push({ name, file: file.relative, line: index + 1, source: line.trim(), confidence: 0.94 });
      }
    });
  }
  return dedupeEvents(events);
}

function detectUiActions(files: Array<{ relative: string; text: string }>, detectedEvents: DetectedEvent[]): UIAction[] {
  const trackedFiles = new Set(detectedEvents.map((event) => event.file));
  const actions: UIAction[] = [];
  for (const file of files) {
    const lines = file.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const buttonLabels = [
        ...uniqueMatches(line, /<button[^>]*>([^<]{2,80})<\/button>/gi, 1),
        ...uniqueMatches(line, /aria-label=["']([^"']{2,80})["']/gi, 1),
      ];
      for (const label of buttonLabels) actions.push(makeAction("button", label, file.relative, index + 1, trackedFiles.has(file.relative)));

      if (/<form[\s>]/i.test(line)) actions.push(makeAction("form", formLabelFromPath(file.relative), file.relative, index + 1, trackedFiles.has(file.relative)));

      const links = uniqueMatches(line, /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]{2,80})<\/a>/gi, 2);
      for (const label of links) actions.push(makeAction("link", label, file.relative, index + 1, trackedFiles.has(file.relative)));
    });
  }
  return dedupeActions(actions).filter((action) => action.confidence >= 0.42);
}

function makeAction(kind: UIAction["kind"], rawLabel: string, file: string, line: number, fileHasTracking: boolean): UIAction {
  const label = normalizeLabel(rawLabel);
  const text = `${label} ${file}`;
  const highIntent = /pricing|signup|sign up|register|get started|start|trial|checkout|payment|subscribe|contact|demo|newsletter|search|copy|api key|create|login|onboarding/i.test(text);
  const suggestedEventName = eventNameFor(kind, label, file);
  return {
    kind,
    label,
    file,
    line,
    suggestedEventName,
    reason: highIntent ? "High-intent UI action that can clarify conversion and funnel performance." : "User action detected without an obvious dedicated GA4 event.",
    confidence: Math.min(0.95, (highIntent ? 0.78 : 0.48) - (fileHasTracking ? 0.12 : 0)),
  };
}

function eventNameFor(kind: UIAction["kind"], label: string, file: string): string {
  const base = `${label} ${file}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .split("_")
    .filter((part) => !["app", "pages", "src", "components", "page", "tsx", "jsx", "ts", "js"].includes(part))
    .slice(0, 5)
    .join("_");
  return `${kind}_${base || "interaction"}`;
}

function suggestFunnels(routes: RouteInfo[], actions: UIAction[], events: DetectedEvent[]): Funnel[] {
  const eventNames = new Set(events.map((event) => event.name));
  const actionEvents = actions.map((action) => action.suggestedEventName);
  const hasPricing = routes.some((route) => /pricing/i.test(route.path));
  const hasSignup = routes.some((route) => /signup|register|auth/i.test(route.path)) || actionEvents.some((event) => /signup|register|get_started/.test(event));
  const hasCheckout = routes.some((route) => /checkout|billing|payment/i.test(route.path)) || actionEvents.some((event) => /checkout|payment|subscribe|plan/.test(event));
  const funnels: Funnel[] = [];

  funnels.push({
    id: "acquisition-to-conversion",
    name: "Acquisition to conversion",
    description: "Tracks the path from first page view to the strongest detected conversion action.",
    steps: [
      { name: "Page view", eventName: eventNames.has("page_view") ? "page_view" : "page_view", description: "User views a page." },
      ...(hasPricing ? [{ name: "Pricing intent", eventName: "view_pricing", description: "User reaches or interacts with pricing." }] : []),
      ...(hasSignup ? [{ name: "Signup intent", eventName: firstMatching(actionEvents, /signup|register|get_started/) ?? "sign_up_start", description: "User starts account creation." }] : []),
      ...(hasCheckout ? [{ name: "Checkout intent", eventName: firstMatching(actionEvents, /checkout|payment|subscribe|plan/) ?? "begin_checkout", description: "User starts payment or plan selection." }] : []),
    ],
  });

  if (actions.some((action) => /docs|api|copy|search/i.test(`${action.label} ${action.file}`))) {
    funnels.push({
      id: "developer-activation",
      name: "Developer activation",
      description: "Tracks docs and API discovery actions that indicate technical activation.",
      steps: [
        { name: "Docs view", eventName: "view_docs", description: "User views documentation." },
        { name: "Docs search or copy", eventName: firstMatching(actionEvents, /search|copy|api/) ?? "docs_interaction", description: "User searches docs, copies code, or interacts with API content." },
      ],
    });
  }

  return funnels;
}

function suggestDashboardWidgets(events: DetectedEvent[], actions: UIAction[], funnels: Funnel[]): DashboardWidget[] {
  const conversion = actions.find((action) => action.confidence >= 0.74)?.suggestedEventName;
  return [
    { id: "active-users", title: "Active users", type: "metric", metric: "activeUsers" },
    { id: "sessions", title: "Sessions", type: "line", metric: "sessions" },
    { id: "conversions", title: "Conversions", type: "bar", eventName: conversion ?? events[0]?.name ?? "generate_lead" },
    ...funnels.slice(0, 2).map((funnel) => ({ id: `funnel-${funnel.id}`, title: funnel.name, type: "funnel" as const })),
  ];
}

function inferFramework(dependencies: Record<string, string>, routes: RouteInfo[]): string {
  if (dependencies.next || routes.some((route) => route.type === "app")) return "Next.js";
  if (dependencies.react) return "React";
  return "unknown";
}

function inferAppType(routes: RouteInfo[], actions: UIAction[], dependencies: Record<string, string>) {
  const signals = [...routes.map((route) => route.path), ...actions.map((action) => `${action.label} ${action.file}`), ...Object.keys(dependencies)];
  const joined = signals.join(" ");
  if (/docs|api|sdk|developer|copy/i.test(joined)) return { type: "developer_tool", confidence: 0.78, signals: signals.filter((signal) => /docs|api|sdk|developer|copy/i.test(signal)).slice(0, 10) };
  if (/checkout|payment|cart|stripe|billing/i.test(joined)) return { type: "commerce_or_saas", confidence: 0.74, signals: signals.filter((signal) => /checkout|payment|cart|stripe|billing/i.test(signal)).slice(0, 10) };
  if (/dashboard|admin|workspace|onboarding/i.test(joined)) return { type: "saas_app", confidence: 0.68, signals: signals.filter((signal) => /dashboard|admin|workspace|onboarding/i.test(signal)).slice(0, 10) };
  return { type: "website", confidence: 0.52, signals: routes.slice(0, 10).map((route) => route.path) };
}

function firstMatching(values: string[], pattern: RegExp): string | undefined {
  return values.find((value) => pattern.test(value));
}

function uniqueMatches(text: string, pattern: RegExp, captureIndex = 0): string[] {
  return [...text.matchAll(pattern)].map((match) => match[captureIndex]).filter(Boolean);
}

function normalizeLabel(label: string): string {
  return label.replace(/\{.*?\}/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "interaction";
}

function formLabelFromPath(file: string): string {
  if (/contact/i.test(file)) return "contact form submit";
  if (/newsletter/i.test(file)) return "newsletter signup";
  if (/login/i.test(file)) return "login submit";
  if (/signup|register/i.test(file)) return "signup submit";
  if (/checkout|payment/i.test(file)) return "checkout submit";
  return "form submit";
}

function dedupeEvents(events: DetectedEvent[]): DetectedEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.name}:${event.file}:${event.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeActions(actions: UIAction[]): UIAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.kind}:${action.label}:${action.file}:${action.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
