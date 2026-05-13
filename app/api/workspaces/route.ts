import { NextRequest, NextResponse } from "next/server";
import { createWorkspace, getWorkspaceBootstrap } from "@/lib/workspaces";

const MAX_SESSION_ID_LENGTH = 128;

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");

  if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH) {
    return NextResponse.json({ error: "Invalid sessionId." }, { status: 400 });
  }

  try {
    const data = await getWorkspaceBootstrap(sessionId, workspaceId);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to load workspaces:", error);
    return NextResponse.json(
      { error: "Failed to load workspaces." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId, name, description } = (await req.json()) as {
      sessionId?: string;
      name?: string;
      description?: string;
    };

    if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH) {
      return NextResponse.json({ error: "Invalid sessionId." }, { status: 400 });
    }

    const workspace = await createWorkspace({ sessionId, name, description });
    return NextResponse.json({ workspace });
  } catch (error) {
    console.error("Failed to create workspace:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create workspace.",
      },
      { status: 500 }
    );
  }
}
