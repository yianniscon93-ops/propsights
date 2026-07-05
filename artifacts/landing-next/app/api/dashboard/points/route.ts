import { NextResponse } from "next/server";
import { getPoints } from "@/lib/server/marketData";
import { parseFilters } from "@/lib/dashboard/filters";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const filters = parseFilters(new URL(req.url).searchParams);
  const points = await getPoints(filters);
  return NextResponse.json(points, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
