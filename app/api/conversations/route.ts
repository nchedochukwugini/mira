import { NextResponse } from "next/server";
import { createConversation, listConversations } from "@/lib/db";
import { databaseFailure, isUuid } from "@/lib/db/api-error";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json({ conversations: await listConversations() }); }
  catch (error) { const failure = databaseFailure(error, "loading history"); return NextResponse.json(failure.body, { status: failure.status }); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { id?: unknown; title?: unknown };
    if (body.id !== undefined && !isUuid(body.id)) return NextResponse.json({ error: "Conversation ID must be a UUID.", code: "invalid_conversation_id" }, { status: 400 });
    const conversation = await createConversation(typeof body.title === "string" ? body.title : undefined, typeof body.id === "string" ? body.id : undefined);
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) { const failure = databaseFailure(error, "creating conversation"); return NextResponse.json(failure.body, { status: failure.status }); }
}
