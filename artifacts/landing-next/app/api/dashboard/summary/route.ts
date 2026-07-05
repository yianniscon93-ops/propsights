import { NextResponse } from "next/server";
import { getSummary } from "@/lib/server/marketData";

export const dynamic = "force-dynamic";

export async function GET() {
  const summary = await getSummary();
  return NextResponse.json(summary, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
