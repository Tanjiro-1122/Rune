import { NextRequest, NextResponse } from "next/server";
import { createConversation } from "@/lib/workspaces";
import { resolveOwnerSessionId } from "@/lib/owner-session";

const MAX_SESSION_ID_LENGTH = 128;
const MAX_WORKSPACE_ID_LENGTH = 128;

export async function POST(req: NextRequest) {
  try {
    const { sessionId: clientSessionId, workspaceId, title } = (await req.json()) as {
      sessionId?: string;
      workspaceId?: string;
      title?: string;
    };

    const sessionId = await resolveOwnerSessionId(req, clientSessionId);

    if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH) {
      return NextResponse.json({ error: "Invalid sessionId." }, { status: 400 });
    }

    if (!workspaceId || workspaceId.length > MAX_WORKSPACE_ID_LENGTH) {
      return NextResponse.json({ error: "Invalid workspaceId." }, { status: 400 });
    }

    const conversation = await createConversation({
      sessionId,
      workspaceId,
      title,
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    if (error instanceof Error && error.message.includes("access denied")) {
      return NextResponse.json({ error: "Workspace access denied." }, { status: 403 });
    }
    console.error("Failed to create conversation:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create conversation.",
      },
      { status: 500 }
    );
  }
}
