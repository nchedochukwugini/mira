import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { collectActiveSecondarySnapshots } from "@/lib/panta/snapshot-collector";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request: Request) {
  const expected = process.env.SNAPSHOT_COLLECTOR_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized snapshot collector request." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  let maxMarkets = 10;
  try {
    const body = await request.json() as { maxMarkets?: unknown };
    if (typeof body.maxMarkets === "number" && Number.isFinite(body.maxMarkets)) maxMarkets = body.maxMarkets;
  } catch { /* An empty body uses the bounded default. */ }
  try {
    const result = await collectActiveSecondarySnapshots(maxMarkets);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Snapshot collection failed." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
