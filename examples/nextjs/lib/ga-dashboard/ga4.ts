import { BetaAnalyticsDataClient } from "@google-analytics/data";

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
    property: `properties/${propertyId}`,
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
  const privateKey = process.env.GA4_PRIVATE_KEY?.replace(/\\n/g, "\n");

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
