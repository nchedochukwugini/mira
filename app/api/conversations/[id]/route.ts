import { NextResponse } from "next/server";
import { deleteConversation, getConversation } from "@/lib/db";
import { databaseFailure, isUuid } from "@/lib/db/api-error";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Conversation ID must be a UUID.", code: "invalid_conversation_id" }, { status: 400 });
    const conversation = await getConversation(id);
    return conversation ? NextResponse.json({ conversation }) : NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  } catch (error) { const failure = databaseFailure(error, "loading conversation"); return NextResponse.json(failure.body, { status: failure.status }); }
}
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const { id } = await params; if (!isUuid(id)) return NextResponse.json({ error: "Conversation ID must be a UUID.", code: "invalid_conversation_id" }, { status: 400 }); return NextResponse.json({ deleted: await deleteConversation(id) }); }
  catch (error) { const failure = databaseFailure(error, "deleting conversation"); return NextResponse.json(failure.body, { status: failure.status }); }
}
