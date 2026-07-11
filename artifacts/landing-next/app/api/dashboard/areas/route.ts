import { NextResponse } from "next/server";
import { getAreas } from "@/lib/server/marketData";

export const dynamic = "force-dynamic";

export async function GET() {
  const areas = await getAreas();
  return NextResponse.json(areas, {
    headers: { "Cache-Control": "private, max-age=3600" },
  });
}
