import { NextResponse } from "next/server";
import { fetchGa4DashboardData } from "../../../lib/ga-dashboard/ga4";

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
