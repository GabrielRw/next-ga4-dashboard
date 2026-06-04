export type GaDashboardWidget = {
  id: string;
  title: string;
  type: "metric" | "line" | "bar" | "funnel" | "table";
  eventName?: string;
  metric?: string;
};

export type GaDashboardFunnel = {
  id: string;
  name: string;
  description: string;
  steps: Array<{
    name: string;
    eventName: string;
    description: string;
  }>;
};

export type GaRecommendedEvent = {
  name: string;
  label: string;
  file: string;
  reason: string;
};

export type GaDashboardConfig = {
  widgets: GaDashboardWidget[];
  funnels: GaDashboardFunnel[];
  recommendedEvents: GaRecommendedEvent[];
};
