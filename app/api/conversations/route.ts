import { NextRequest, NextResponse } from "next/server";
import { createConversation } from "@/lib/workspaces";

const MAX_SESSION_ID_LENGTH = 128;
const MAX_WORKSPACE_ID_LENGTH = 128;

export async function POST(req: NextRequest) {
  try {
    const { sessionId, workspaceId, title } = (await req.json()) as {
      sessionId?: string;
      workspaceId?: string;
      title?: string;
    };

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
