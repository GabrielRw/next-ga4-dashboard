import { z } from "zod";

export const routeSchema = z.object({
  path: z.string(),
  file: z.string(),
  type: z.enum(["app", "pages"]),
});

export const detectedEventSchema = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number(),
  source: z.string(),
  confidence: z.number().min(0).max(1),
});

export const uiActionSchema = z.object({
  kind: z.enum(["button", "form", "link"]),
  label: z.string(),
  file: z.string(),
  line: z.number(),
  suggestedEventName: z.string(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

export const funnelStepSchema = z.object({
  name: z.string(),
  eventName: z.string(),
  description: z.string(),
});

export const funnelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  steps: z.array(funnelStepSchema).min(1),
});

export const dashboardWidgetSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(["metric", "line", "bar", "funnel", "table"]),
  eventName: z.string().optional(),
  metric: z.string().optional(),
});

export const auditSchema = z.object({
  version: z.literal("0.1"),
  generatedAt: z.string(),
  projectRoot: z.string(),
  framework: z.string(),
  packageManager: z.string(),
  analytics: z.object({
    libraries: z.array(z.string()),
    gaMeasurementIds: z.array(z.string()),
    gtmContainerIds: z.array(z.string()),
    hasPageViewTracking: z.boolean(),
  }),
  routes: z.array(routeSchema),
  detectedEvents: z.array(detectedEventSchema),
  missingRecommendedEvents: z.array(uiActionSchema),
  suggestedFunnels: z.array(funnelSchema),
  dashboardWidgets: z.array(dashboardWidgetSchema),
});

export const auditContextSchema = auditSchema.extend({
  dependencies: z.record(z.string()),
  importantFiles: z.array(z.string()),
  detectedForms: z.array(uiActionSchema),
  detectedButtons: z.array(uiActionSchema),
  detectedLinks: z.array(uiActionSchema),
  possibleConversionPoints: z.array(uiActionSchema),
  possiblePaymentCheckoutFlows: z.array(uiActionSchema),
  possibleOnboardingFlows: z.array(uiActionSchema),
  possibleDocsApiProductFlows: z.array(uiActionSchema),
  appTypeInference: z.object({
    type: z.string(),
    confidence: z.number().min(0).max(1),
    signals: z.array(z.string()),
  }),
});

export type RouteInfo = z.infer<typeof routeSchema>;
export type DetectedEvent = z.infer<typeof detectedEventSchema>;
export type UIAction = z.infer<typeof uiActionSchema>;
export type Funnel = z.infer<typeof funnelSchema>;
export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>;
export type Audit = z.infer<typeof auditSchema>;
export type AuditContext = z.infer<typeof auditContextSchema>;
