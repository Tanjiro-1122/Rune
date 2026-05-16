import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createRepoActionProposal,
  draftRepoActionDiff,
  generateRepoActionProposedDiff,
  inspectRepoActionFiles,
  listRepoActionProposals,
  openRepoActionPullRequest,
  runApprovedRepoActionExecutor,
  runTemporaryWorkspaceBuildCheck,
  sandboxCheckRepoActionDiff,
  trackRepoActionPullRequest,
  updateRepoActionStatus,
} from "@/lib/repo-actions";

const FileTargetSchema = z.object({
  path: z.string().min(1).max(240),
  operation: z.enum(["create", "update", "delete", "inspect"]).optional(),
  note: z.string().max(500).optional(),
});

const CreateProposalSchema = z.object({
  title: z.string().min(1).max(180),
  summary: z.string().min(1).max(900),
  findings: z.string().max(6000).optional(),
  plan: z.string().max(6000).optional(),
  repo: z.string().max(160).nullable().optional(),
  projectKey: z.string().max(80).nullable().optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  files: z.array(FileTargetSchema).max(20).optional(),
  diffPreview: z.string().max(10000).optional(),
  sessionId: z.string().max(120).nullable().optional(),
  workspaceId: z.string().uuid().nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
});

const UpdateProposalSchema = z.object({
  id: z.string().min(1).max(120),
  action: z.enum(["status", "draft_diff", "inspect_repo", "generate_diff", "sandbox_check", "temp_workspace_check", "open_pr", "track_pr", "execute_approved"]).default("status"),
  status: z.enum(["approved", "rejected", "blocked", "cancelled"]).optional(),
  approvalNote: z.string().max(700).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const projectKey = req.nextUrl.searchParams.get("projectKey") ?? undefined;
  const proposals = await listRepoActionProposals({ projectKey, limit: 30 });
  return NextResponse.json({ proposals });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = CreateProposalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid repo action proposal.", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await createRepoActionProposal(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Failed to create proposal." }, { status: 500 });
  }

  return NextResponse.json(result, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = UpdateProposalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid repo action update.", details: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.action === "draft_diff") {
    const result = await draftRepoActionDiff({ id: parsed.data.id });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed to draft diff." }, { status: 500 });
    }
    return NextResponse.json(result);
  }

  if (parsed.data.action === "inspect_repo") {
    const result = await inspectRepoActionFiles({ id: parsed.data.id });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed to inspect repo files." }, { status: 500 });
    }
    return NextResponse.json(result);
  }

  if (parsed.data.action === "generate_diff") {
    const result = await generateRepoActionProposedDiff({ id: parsed.data.id });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed to generate proposed diff." }, { status: 500 });
    }
    return NextResponse.json(result);
  }

  if (parsed.data.action === "sandbox_check") {
    const result = await sandboxCheckRepoActionDiff({ id: parsed.data.id });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed to run sandbox check." }, { status: 500 });
    }
    return NextResponse.json(result);
  }

  if (parsed.data.action === "temp_workspace_check") {
    const result = await runTemporaryWorkspaceBuildCheck({ id: parsed.data.id });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed to run temporary workspace check." }, { status: 500 });
    }
    return NextResponse.json(result);
  }

  if (parsed.data.action === "open_pr") {
    const result = await openRepoActionPullRequest({ id: parsed.data.id });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed to open pull request." }, { status: 500 });
    }
    return NextResponse.json(result);
  }

  if (parsed.data.action === "track_pr") {
    const result = await trackRepoActionPullRequest({ id: parsed.data.id });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed to track pull request." }, { status: 500 });
    }
    return NextResponse.json(result);
  }

  if (parsed.data.action === "execute_approved") {
    const result = await runApprovedRepoActionExecutor({ id: parsed.data.id });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed to run controlled executor.", steps: result.steps, stoppedAt: result.stoppedAt }, { status: 500 });
    }
    return NextResponse.json(result);
  }

  if (!parsed.data.status) {
    return NextResponse.json({ error: "Status is required for this update." }, { status: 400 });
  }

  const result = await updateRepoActionStatus({
    id: parsed.data.id,
    status: parsed.data.status,
    approvalNote: parsed.data.approvalNote,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Failed to update proposal." }, { status: 500 });
  }

  return NextResponse.json(result);
}
