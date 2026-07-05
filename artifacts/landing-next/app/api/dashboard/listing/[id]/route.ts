import { NextResponse } from "next/server";
import { getListing } from "@/lib/server/marketData";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,20}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const listing = await getListing(id);
  if (!listing) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(listing, {
    headers: { "Cache-Control": "private, max-age=600" },
  });
}
