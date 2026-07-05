import { NextResponse } from "next/server";
import { getPricing } from "@/lib/server/marketData";
import { parseFilters } from "@/lib/dashboard/filters";
import type { PolygonCoords } from "@/lib/dashboard/types";

export const dynamic = "force-dynamic";

const MAX_VERTICES = 200;

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
  let body: { polygon?: unknown; filters?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const polygon = body.polygon == null ? null : parsePolygon(body.polygon);
  if (body.polygon != null && !polygon) {
    return NextResponse.json(
      { error: `polygon must be 3–${MAX_VERTICES} [lat,lng] pairs` },
      { status: 400 }
    );
  }

  const filters = parseFilters(
    body.filters && typeof body.filters === "object"
      ? (body.filters as Record<string, unknown>)
      : {}
  );

  const pricing = await getPricing(filters, polygon);
  return NextResponse.json(pricing);
}
