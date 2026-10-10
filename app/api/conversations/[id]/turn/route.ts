import { NextResponse } from "next/server";
import { saveAssistantTurn } from "@/lib/db";
import { databaseFailure, isUuid } from "@/lib/db/api-error";

export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Conversation ID must be a UUID.", code: "invalid_conversation_id" }, { status: 400 });
    const body = await request.json() as { assistantMessage?: unknown; messageId?: unknown; state?: unknown };
    if (typeof body.assistantMessage !== "string") return NextResponse.json({ error: "An assistant response is required." }, { status: 400 });
    if (body.messageId !== undefined && !isUuid(body.messageId)) return NextResponse.json({ error: "Message retry ID must be a UUID.", code: "invalid_message_id" }, { status: 400 });
    await saveAssistantTurn(id, body.assistantMessage.slice(0, 12000), body.state, typeof body.messageId === "string" ? body.messageId : undefined);
    return NextResponse.json({ saved: true });
  } catch (error) { const failure = databaseFailure(error, "saving assistant response"); return NextResponse.json(failure.body, { status: failure.status }); }
}
