import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listPrivilegedOperationPolicies, evaluatePrivilegedOperationGate } from "@/lib/privileged-operations";
import { runPrivilegedMerge } from "@/lib/privileged-merge";
import { runPrivilegedDeployment } from "@/lib/privileged-deployment";
import { resolveOwnerSessionId } from "@/lib/owner-session";

const OperationSchema = z.object({
  action: z.enum(["list_policies", "evaluate_gate", "merge", "deploy", "rollback"]),
  kind: z.enum(["merge", "deploy", "rollback", "change_payments", "grant_entitlements", "mutate_schema", "mutate_dns", "mutate_customer_systems"]).optional(),
  approvalText: z.string().max(120).nullable().optional(),
  dryRun: z.boolean().default(true),
  scope: z.record(z.string(), z.unknown()).nullable().optional(),
  evidence: z.record(z.string(), z.unknown()).nullable().optional(),
  repo: z.string().max(180).optional(),
  prNumber: z.number().int().positive().optional(),
  deploymentId: z.string().max(180).nullable().optional(),
  project: z.string().max(120).nullable().optional(),
  environment: z.string().max(80).nullable().optional(),
  commitSha: z.string().max(120).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
  buildPassed: z.boolean().nullable().optional(),
  projectKey: z.string().max(80).nullable().optional(),
  workspaceId: z.string().uuid().nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
  sessionId: z.string().max(120).nullable().optional(),
});

export async function GET() {
  return NextResponse.json({ policies: listPrivilegedOperationPolicies() });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = OperationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid privileged operation request.", details: parsed.error.flatten() }, { status: 400 });
  }

  const sessionId = await resolveOwnerSessionId(req, parsed.data.sessionId ?? null);

  if (parsed.data.action === "list_policies") {
    return NextResponse.json({ policies: listPrivilegedOperationPolicies() });
  }

  if (parsed.data.action === "evaluate_gate") {
    if (!parsed.data.kind) return NextResponse.json({ error: "kind is required for gate evaluation." }, { status: 400 });
    return NextResponse.json({ gate: evaluatePrivilegedOperationGate({
      kind: parsed.data.kind,
      approvalText: parsed.data.approvalText,
      dryRun: parsed.data.dryRun,
      scope: parsed.data.scope,
      evidence: parsed.data.evidence,
      projectKey: parsed.data.projectKey || "rune",
      workspaceId: parsed.data.workspaceId,
      conversationId: parsed.data.conversationId,
    }) });
  }

  if (parsed.data.action === "merge") {
    if (!parsed.data.repo || !parsed.data.prNumber) return NextResponse.json({ error: "repo and prNumber are required for merge." }, { status: 400 });
    const result = await runPrivilegedMerge({
      repo: parsed.data.repo,
      prNumber: parsed.data.prNumber,
      approvalText: parsed.data.approvalText,
      dryRun: parsed.data.dryRun,
      requestedBy: sessionId,
      projectKey: parsed.data.projectKey || "rune",
      workspaceId: parsed.data.workspaceId,
      conversationId: parsed.data.conversationId,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (parsed.data.action === "deploy" || parsed.data.action === "rollback") {
    const result = await runPrivilegedDeployment({
      kind: parsed.data.action,
      deploymentId: parsed.data.deploymentId,
      approvalText: parsed.data.approvalText,
      dryRun: parsed.data.dryRun,
      project: parsed.data.project,
      environment: parsed.data.environment,
      commitSha: parsed.data.commitSha,
      reason: parsed.data.reason,
      buildPassed: parsed.data.buildPassed,
      requestedBy: sessionId,
      projectKey: parsed.data.projectKey || "rune",
      workspaceId: parsed.data.workspaceId,
      conversationId: parsed.data.conversationId,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  return NextResponse.json({ error: "Unsupported privileged operation action." }, { status: 400 });
}
