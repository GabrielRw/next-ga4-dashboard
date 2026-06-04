import path from "node:path";
import { promises as fs } from "node:fs";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AuditContext, auditSchema } from "./schemas.js";
import { compactAudit } from "./scanner.js";
import { writeJsonFile } from "./fs-utils.js";

export async function writeBasicAudit(projectRoot: string, context: AuditContext): Promise<string> {
  const outputPath = path.join(projectRoot, "ga-dashboard.audit.json");
  await writeJsonFile(outputPath, compactAudit(context));
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
