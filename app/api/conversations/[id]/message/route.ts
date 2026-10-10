import { NextResponse } from "next/server";
import { appendMessage } from "@/lib/db";
import { databaseFailure, isUuid } from "@/lib/db/api-error";

export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Conversation ID must be a UUID.", code: "invalid_conversation_id" }, { status: 400 });
    const body = await request.json() as { content?: unknown; messageId?: unknown };
    if (typeof body.content !== "string" || !body.content.trim()) return NextResponse.json({ error: "A message is required." }, { status: 400 });
    if (body.messageId !== undefined && !isUuid(body.messageId)) return NextResponse.json({ error: "Message retry ID must be a UUID.", code: "invalid_message_id" }, { status: 400 });
    const message = await appendMessage(id, "user", body.content.trim().slice(0, 5000), typeof body.messageId === "string" ? body.messageId : undefined);
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) { const failure = databaseFailure(error, "saving message"); return NextResponse.json(failure.body, { status: failure.status }); }
}
