import postgres from "postgres";

/**
 * Lazy singleton over the serving-layer Postgres (schema owned by data
 * engineering — read-only from this app). Returns null when DATABASE_URL
 * is not configured, in which case callers serve demo data.
 *
 * Local dev against the Hetzner box (Postgres is localhost-only there):
 *   ssh -N -L 5433:localhost:5432 root@204.168.209.175
 *   DATABASE_URL=postgresql://bnb:bnb@localhost:5433/bnb
 */
declare global {
  // eslint-disable-next-line no-var
  var __psSql: ReturnType<typeof postgres> | null | undefined;
}

export function getSql(): ReturnType<typeof postgres> | null {
  if (globalThis.__psSql !== undefined) return globalThis.__psSql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    globalThis.__psSql = null;
    return null;
  }
  globalThis.__psSql = postgres(url, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 5,
    // NUMERIC comes back as string by default; the queries cast to float
    // explicitly, so no transform needed here.
  });
  return globalThis.__psSql;
}
