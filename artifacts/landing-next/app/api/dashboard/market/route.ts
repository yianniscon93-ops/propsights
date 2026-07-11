import { NextResponse } from "next/server";
import { getMarket } from "@/lib/server/marketData";
import type { MarketRequest, PolygonCoords } from "@/lib/dashboard/types";

export const dynamic = "force-dynamic";

const MAX_VERTICES = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parsePolygon(input: unknown): PolygonCoords | null {
  if (!Array.isArray(input) || input.length < 3 || input.length > MAX_VERTICES) return null;
  const poly: PolygonCoords = [];
  for (const v of input) {
    if (!Array.isArray(v) || v.length !== 2) return null;
    const [lat, lng] = v;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    poly.push([lat, lng]);
  }
  return poly;
}

export async function POST(req: Request) {
  let body: {
    selection?: { kind?: unknown; areaId?: unknown; coords?: unknown };
    filters?: unknown;
    weekStart?: unknown;
    weekEnd?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const kind = body.selection?.kind;
  let selection: MarketRequest["selection"];
  if (kind === "area" && typeof body.selection?.areaId === "string" && body.selection.areaId.length <= 20) {
    selection = { kind: "area", areaId: body.selection.areaId };
  } else if (kind === "polygon") {
    const coords = parsePolygon(body.selection?.coords);
    if (!coords) return NextResponse.json({ error: "invalid polygon" }, { status: 400 });
    selection = { kind: "polygon", coords };
  } else {
    selection = { kind: "all" };
  }

  const weekStart = typeof body.weekStart === "string" && ISO_DATE.test(body.weekStart) ? body.weekStart : "2026-04-06";
  const weekEnd = typeof body.weekEnd === "string" && ISO_DATE.test(body.weekEnd) ? body.weekEnd : weekStart;
  const filters =
    body.filters && typeof body.filters === "object" ? (body.filters as Record<string, unknown>) : {};

  const data = await getMarket({ selection, filters, weekStart, weekEnd });
  return NextResponse.json(data);
}
