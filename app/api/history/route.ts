import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/errors";
import { getConversationHistory } from "@/lib/workspaces";

const MAX_SESSION_ID_LENGTH = 128;
const MAX_RESOURCE_ID_LENGTH = 128;

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  const conversationId = req.nextUrl.searchParams.get("conversationId");

  if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH) {
    return NextResponse.json({ error: "Invalid sessionId." }, { status: 400 });
  }

  if (workspaceId && workspaceId.length > MAX_RESOURCE_ID_LENGTH) {
    return NextResponse.json({ error: "Invalid workspaceId." }, { status: 400 });
  }

  if (conversationId && conversationId.length > MAX_RESOURCE_ID_LENGTH) {
    return NextResponse.json({ error: "Invalid conversationId." }, { status: 400 });
  }

  try {
    const history = await getConversationHistory({
      sessionId,
      workspaceId,
      conversationId,
    });
    return NextResponse.json(history);
  } catch (error) {
    if (error instanceof Error && error.message.includes("access denied")) {
      return NextResponse.json({ error: "Conversation access denied." }, { status: 403 });
    }
    logError("api.history.GET", error);
    return NextResponse.json(
      { error: "Failed to load conversation history." },
      { status: 500 }
    );
  }
}
