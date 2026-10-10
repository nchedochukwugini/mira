import { NextResponse } from "next/server";
import { getPantaOrderBookSnapshot } from "@/lib/panta/clob";
import { getSnapshotMicrostructure } from "@/lib/panta/microstructure-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id || id.length > 96) return NextResponse.json({ error: "A valid Panta market id is required." }, { status: 400 });
  const snapshot = await getPantaOrderBookSnapshot(id);
  const microstructure = await getSnapshotMicrostructure(snapshot).catch(() => null);
  return NextResponse.json({ data: { ...snapshot, microstructure } }, { headers: { "Cache-Control": "no-store" } });
}
