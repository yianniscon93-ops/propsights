import { NextResponse } from "next/server";
import { getAreaHealth } from "@/lib/server/marketData";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getAreaHealth());
}
