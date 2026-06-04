import { AnalyticsDashboard } from "../../../components/ga-dashboard/AnalyticsDashboard";
import { gaDashboardConfig } from "../../../lib/ga-dashboard/config";

export default function AnalyticsPage() {
  return <AnalyticsDashboard config={gaDashboardConfig} />;
}
