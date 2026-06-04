#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  Audit,
  auditSchema,
  scanProject,
  validateAgentOutput,
  writeAgentWorkspace,
  writeBasicAudit,
} from "@next-ga4-dashboard/core";
import { generateNextDashboard } from "./next-generator.js";

const program = new Command();

program
  .name("next-ga4-dashboard")
  .description("Local/self-hosted GA4 dashboard generator for Next.js apps.")
  .version("0.1.0");

program
  .command("audit")
  .description("Scan this project locally and generate GA4 audit recommendations.")
  .option("--agent", "Prepare a structured workspace for the user's coding agent.")
  .option("--cwd <path>", "Project root to scan.", process.cwd())
  .action(async (options: { agent?: boolean; cwd: string }) => {
    const projectRoot = path.resolve(options.cwd);
    const context = await scanProject(projectRoot);

    if (options.agent) {
      await writeAgentWorkspace(projectRoot, context);
      await writeBasicAudit(projectRoot, context);
      printAgentPrepared();
      return;
    }

    const outputPath = await writeBasicAudit(projectRoot, context);
    printAuditSummary(outputPath, context);
  });

program
  .command("apply-agent-output")
  .description("Validate ga-dashboard.audit.json after your coding agent completes it.")
  .option("--cwd <path>", "Project root.", process.cwd())
  .action(async (options: { cwd: string }) => {
    const result = await validateAgentOutput(path.resolve(options.cwd));
    if (!result.valid) {
      console.error(`Agent output is invalid: ${result.outputPath}`);
      for (const error of result.errors) console.error(error);
      process.exitCode = 1;
      return;
    }
    console.log(`Agent output is valid: ${result.outputPath}`);
  });

program
  .command("init")
  .description("Generate the self-hosted Next.js analytics dashboard.")
  .option("--from-audit", "Read ga-dashboard.audit.json from the project root.")
  .option("--cwd <path>", "Project root.", process.cwd())
  .option("--route <route>", "Dashboard route under app/.", "admin/analytics")
  .action(async (options: { fromAudit?: boolean; cwd: string; route: string }) => {
    if (!options.fromAudit) {
      console.error("Pass --from-audit to generate from ga-dashboard.audit.json.");
      process.exitCode = 1;
      return;
    }
    const projectRoot = path.resolve(options.cwd);
    const audit = await readAudit(projectRoot);
    const written = await generateNextDashboard(projectRoot, audit, options.route);
    console.log("Generated self-hosted GA4 dashboard:");
    for (const file of written) console.log(`- ${path.relative(projectRoot, file)}`);
    console.log("\nConfigure these environment variables in your own project:");
    console.log("- GA4_PROPERTY_ID");
    console.log("- GOOGLE_APPLICATION_CREDENTIALS or GA4_CLIENT_EMAIL + GA4_PRIVATE_KEY");
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function readAudit(projectRoot: string): Promise<Audit> {
  const auditPath = path.join(projectRoot, "ga-dashboard.audit.json");
  return auditSchema.parse(JSON.parse(await fs.readFile(auditPath, "utf8")));
}

function printAgentPrepared(): void {
  console.log(`Agent audit prepared.

Next step:
Ask your coding agent:

Read .ga-dashboard/agent-instructions.md and complete the Next GA4 Dashboard audit.

When it is done, run:
npx next-ga4-dashboard apply-agent-output
npx next-ga4-dashboard init --from-audit`);
}

function printAuditSummary(outputPath: string, context: Awaited<ReturnType<typeof scanProject>>): void {
  console.log(`Audit complete: ${outputPath}

Existing analytics setup:
- Libraries: ${context.analytics.libraries.join(", ") || "None detected"}
- GA4 IDs: ${context.analytics.gaMeasurementIds.join(", ") || "None detected"}
- GTM IDs: ${context.analytics.gtmContainerIds.join(", ") || "None detected"}

Detected events: ${context.detectedEvents.length}
Missing recommended events: ${context.missingRecommendedEvents.length}
Suggested funnels: ${context.suggestedFunnels.length}
Dashboard widgets: ${context.dashboardWidgets.length}`);
}
