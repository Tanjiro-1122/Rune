import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceTasks, resumeWorkspaceTask } from "@/lib/tasks";
import { resolveOwnerSessionId } from "@/lib/owner-session";

const MAX_SESSION_ID_LENGTH = 128;
const MAX_RESOURCE_ID_LENGTH = 128;

export async function GET(req: NextRequest) {
  const clientSessionId = req.nextUrl.searchParams.get("sessionId");
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  const sessionId = await resolveOwnerSessionId(req, clientSessionId);

  if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!workspaceId || workspaceId.length > MAX_RESOURCE_ID_LENGTH) {
    return NextResponse.json({ error: "Invalid workspaceId." }, { status: 400 });
  }

  if (conversationId && conversationId.length > MAX_RESOURCE_ID_LENGTH) {
    return NextResponse.json({ error: "Invalid conversationId." }, { status: 400 });
  }

  const tasks = await getWorkspaceTasks({
    workspaceId,
    conversationId,
    limit: 12,
  });

  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  try {
    const clientSessionId = req.nextUrl.searchParams.get("sessionId");
    const sessionId = await resolveOwnerSessionId(req, clientSessionId);
    if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { taskId } = (await req.json()) as { taskId?: string };

    if (!taskId || taskId.length > MAX_RESOURCE_ID_LENGTH) {
      return NextResponse.json({ error: "Invalid taskId." }, { status: 400 });
    }

    const resumed = await resumeWorkspaceTask(taskId);
    if (!resumed) {
      return NextResponse.json(
        { error: "Task not found or could not be resumed." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      task: resumed,
      message:
        "Task has been queued for resume. Re-submit to continue from the saved context.",
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to resume task." },
      { status: 500 }
    );
  }
}
