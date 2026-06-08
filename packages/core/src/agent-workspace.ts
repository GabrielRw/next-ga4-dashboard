import path from "node:path";
import { promises as fs } from "node:fs";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AuditContext, auditSchema } from "./schemas.js";
import { compactAudit } from "./scanner.js";
import { writeJsonFile } from "./fs-utils.js";

export async function writeBasicAudit(projectRoot: string, context: AuditContext): Promise<string> {
  const outputPath = path.join(projectRoot, "ga-dashboard.audit.json");
  await writeJsonFile(outputPath, compactAudit(context));
  await fs.writeFile(path.join(projectRoot, "ga-dashboard.prompts.md"), renderReadyPrompts(context), "utf8");
  return outputPath;
}

export async function writeAgentWorkspace(projectRoot: string, context: AuditContext): Promise<void> {
  const dir = path.join(projectRoot, ".ga-dashboard");
  await fs.mkdir(dir, { recursive: true });
  await writeJsonFile(path.join(dir, "audit-context.json"), context);
  await writeJsonFile(path.join(dir, "suggested-files.json"), {
    files: context.importantFiles,
    note: "Open these files first for deeper semantic audit work.",
  });
  await writeJsonFile(path.join(dir, "detected-events.json"), context.detectedEvents);
  await writeJsonFile(path.join(dir, "route-map.json"), context.routes);
  await writeJsonFile(path.join(dir, "ui-actions.json"), {
    forms: context.detectedForms,
    buttons: context.detectedButtons,
    links: context.detectedLinks,
  });
  await writeJsonFile(path.join(dir, "funnels.draft.json"), context.suggestedFunnels);
  await writeJsonFile(path.join(dir, "schema.json"), zodToJsonSchema(auditSchema, "GaDashboardAudit"));
  await fs.writeFile(path.join(dir, "audit-summary.md"), renderAuditSummary(context), "utf8");
  await fs.writeFile(path.join(dir, "agent-instructions.md"), renderAgentInstructions(), "utf8");
  await fs.writeFile(path.join(dir, "ready-prompts.md"), renderReadyPrompts(context), "utf8");
}

export async function validateAgentOutput(projectRoot: string): Promise<{ valid: boolean; outputPath: string; errors: string[] }> {
  const outputPath = path.join(projectRoot, "ga-dashboard.audit.json");
  try {
    const raw = JSON.parse(await fs.readFile(outputPath, "utf8"));
    auditSchema.parse(raw);
    return { valid: true, outputPath, errors: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, outputPath, errors: [message] };
  }
}

function renderAuditSummary(context: AuditContext): string {
  return `# Next GA4 Dashboard Audit Summary

Generated: ${context.generatedAt}

## Project

- Framework: ${context.framework}
- Package manager: ${context.packageManager}
- App type inference: ${context.appTypeInference.type} (${Math.round(context.appTypeInference.confidence * 100)}%)

## Analytics

- Libraries: ${context.analytics.libraries.join(", ") || "None detected"}
- GA4 measurement IDs: ${context.analytics.gaMeasurementIds.join(", ") || "None detected"}
- GTM container IDs: ${context.analytics.gtmContainerIds.join(", ") || "None detected"}
- Page view tracking: ${context.analytics.hasPageViewTracking ? "Detected" : "Not detected"}

## Counts

- Routes: ${context.routes.length}
- Existing events: ${context.detectedEvents.length}
- Missing recommended events: ${context.missingRecommendedEvents.length}
- Suggested funnels: ${context.suggestedFunnels.length}

## Prompt File

Use \`ga-dashboard.prompts.md\` or \`.ga-dashboard/ready-prompts.md\` to ask a coding agent or analytics operator to reconcile existing GA4 events, add missing events, and finalize funnels.
`;
}

function renderAgentInstructions(): string {
  return `# Next GA4 Dashboard Agent Instructions

You are completing a local analytics audit. Do not upload source code or call remote AI APIs.

Read these files first:

1. .ga-dashboard/audit-context.json
2. .ga-dashboard/suggested-files.json
3. .ga-dashboard/detected-events.json
4. .ga-dashboard/ui-actions.json
5. .ga-dashboard/funnels.draft.json
6. .ga-dashboard/ready-prompts.md

Then inspect the suggested source files directly in this repository.

Your job:

- Understand the product and primary user journeys.
- Identify existing GA4/GTM/page-view/conversion tracking.
- Add or revise missing recommended GA4 events.
- Produce the strongest funnel definitions for the product.
- Choose dashboard widgets that match available and recommended events.
- Write the final ga-dashboard.audit.json file at the project root.

The output must match .ga-dashboard/schema.json. Do not modify application source files unless the user explicitly asks you to.
`;
}

function renderReadyPrompts(context: AuditContext): string {
  const existingEvents = context.detectedEvents
    .slice(0, 60)
    .map((event) => `- ${event.name} (${event.file}:${event.line})`)
    .join("\n") || "- No events detected in code.";

  const missingEvents = context.missingRecommendedEvents
    .slice(0, 40)
    .map((action) => `- ${action.suggestedEventName}: ${action.label} (${action.kind}, ${action.file}:${action.line})`)
    .join("\n") || "- No missing recommended events detected.";

  const funnels = context.suggestedFunnels
    .map((funnel) => [
      `### ${funnel.name}`,
      funnel.description,
      ...funnel.steps.map((step, index) => `${index + 1}. ${step.name}: ${step.eventName}`),
    ].join("\n"))
    .join("\n\n") || "No draft funnels generated.";

  const importantFiles = context.importantFiles
    .slice(0, 30)
    .map((file) => `- ${file}`)
    .join("\n") || "- No important files detected.";

  const capabilityLines = [
    `- DataFast detected: ${context.integrationCapabilities?.hasDataFast ? "yes" : "no"}`,
    `- Stripe detected: ${context.integrationCapabilities?.hasStripe ? "yes" : "no"}`,
    `- Supabase detected: ${context.integrationCapabilities?.hasSupabase ? "yes" : "no"}`,
    `- Admin area detected: ${context.integrationCapabilities?.hasAdminArea ? "yes" : "no"}`,
    `- First-party attribution detected: ${context.integrationCapabilities?.hasFirstPartyAttribution ? "yes" : "no"}`,
  ].join("\n");

  return `# Ready Prompts For GA4 Events And Funnels

Generated: ${context.generatedAt}

Use these prompts with your coding agent, analytics teammate, or GA4 operator. They are designed to produce the right events and avoid creating duplicate event names when GA4 already has usable ones.

## Project Snapshot

- Framework: ${context.framework}
- App type: ${context.appTypeInference.type}
- Package manager: ${context.packageManager}

## Integration Signals

${capabilityLines}

## Existing Events Detected In Code

${existingEvents}

## Missing Recommended Events From UI Scan

${missingEvents}

## Draft Funnels

${funnels}

## Files To Inspect First

${importantFiles}

## Prompt 1: Reconcile Existing GA4 Events

\`\`\`text
You are helping me configure a self-hosted GA4 admin dashboard for this Next.js project.

Goal:
Map the product's real user journeys to existing GA4 events where possible, and only recommend new events when no existing GA4 event has the same meaning.

Use this local scanner output:

Existing events detected in code:
${indentForPrompt(existingEvents)}

Missing recommended events from UI scan:
${indentForPrompt(missingEvents)}

Draft funnels:
${indentForPrompt(funnels)}

Instructions:
1. Ask me for a GA4 Events report export if you do not have direct GA4 access. The export should include eventName and eventCount for the last 30 and 90 days.
2. Compare GA4 existing event names with the scanner's desired events.
3. Treat exact semantic matches as existing events, even if the names differ.
4. Prefer stable, once-per-action events for conversion rates. For example, prefer signup_completed over generic sign_up if sign_up can fire multiple times or from Google automatic events.
5. For each funnel step, choose one final event name or page rule.
6. Produce a table with: journey, step, current GA4 event if usable, recommended event if missing, file to instrument, and why.
7. Produce the final funnel definitions as JSON compatible with ga-dashboard.audit.json.
8. Flag events that would inflate metrics because they can fire repeatedly in one session.

Do not invent revenue attribution from GA4 alone. If revenue attribution by page/channel/browser is needed, explain that first-party signup/payment attribution is required.
\`\`\`

## Prompt 2: Implement Missing Events In Code

\`\`\`text
You are modifying this codebase to add missing analytics events for the GA4 dashboard.

Use the scanner output below and inspect the listed files.

Important files:
${indentForPrompt(importantFiles)}

Existing events detected in code:
${indentForPrompt(existingEvents)}

Missing recommended events:
${indentForPrompt(missingEvents)}

Implementation rules:
1. Reuse the existing analytics helper if the project has one. Search for gtag, sendGAEvent, dataLayer.push, trackDataFastGoal, analytics.track, or window.datafast.
2. Do not add duplicate events where an equivalent event already exists.
3. Add events close to the confirmed user action, not on render.
4. Naming should be stable snake_case, for example signup_started, signup_completed, checkout_started, checkout_completed, api_key_created.
5. One-time conversion events must fire once per real action.
6. Include useful parameters without PII: source, plan, page, method, product, result. Do not send email, full names, access tokens, or API keys.
7. If DataFast is present and GA4 mirroring exists, use the DataFast helper only if it mirrors to GA4. Otherwise add a GA4 event too.
8. Return a concise patch summary and the final event list.
\`\`\`

## Prompt 3: Finalize Dashboard Audit JSON

\`\`\`text
You are finalizing ga-dashboard.audit.json for next-ga4-dashboard.

Inputs:
- Existing event list from code and/or GA4
- Missing event decisions
- Product journeys and funnels

Draft funnels:
${indentForPrompt(funnels)}

Output requirements:
1. Keep detectedEvents as events that truly exist in code or GA4.
2. Keep missingRecommendedEvents only for events that still need implementation.
3. Update suggestedFunnels so every step uses either a verified event name or a clear page rule.
4. Choose dashboardWidgets that answer acquisition, activation, conversion, and revenue questions.
5. If Stripe revenue is needed, note that it must come from a server-side backend endpoint.
6. If Search Console keywords are needed, note that OAuth must include webmasters.readonly and GSC_SITE_URL must match the verified property.
7. Return valid JSON matching .ga-dashboard/schema.json.
\`\`\`
`;
}

function indentForPrompt(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
