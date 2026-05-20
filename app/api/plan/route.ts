import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret, SESSION_COOKIE, verifySessionCookie } from "@/lib/auth";
import { buildPlannerOutput } from "@/lib/orchestration";

/**
 * /api/plan
 * Lightweight endpoint — takes the user's input and returns the structured
 * PlannerOutput (intent, steps, route) WITHOUT starting a chat stream.
 * Powers the ⚡ Plan button in the input bar.
 */
export async function POST(req: NextRequest) {
  // Auth check — same pattern as middleware
  const secret = getSessionSecret();
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie || !secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await verifySessionCookie(cookie, secret);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { input?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input = (body.input ?? "").trim();
  if (!input) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }

  const capabilities = {
    codeExecution: { available: true },
    webSearch: true,
    githubAnalysis: true,
  };

  const plan = buildPlannerOutput({ input, capabilities });

  const intentLabels: Record<string, string> = {
    self_audit: "System self-audit",
    tool_lifecycle_diagnostic: "Lifecycle diagnostic",
    capability_truth: "Capability check",
    approval_required: "Requires approval",
    not_connected: "Service not connected",
    repo_proposal: "Repo change proposal",
    code_execution: "Code execution",
    web_search: "Web search",
    github_analysis: "GitHub analysis",
    datetime: "Date/time lookup",
    calculate: "Calculation",
    plan: "Planning task",
    general: "General task",
  };

  const routeLabels: Record<string, string> = {
    answer_only: "Direct answer",
    truth_check: "Capability check first",
    self_audit: "Full system audit",
    inspect_first: "Inspect before acting",
    plan_first: "Plan then execute",
    proposal_required: "Repo Control approval required",
    approval_required: "Javier approval required",
    not_connected: "Connection needed",
  };

  const complexRoutes = ["self_audit", "proposal_required", "approval_required"];
  const isComplex = complexRoutes.includes(plan.reasoningRoute);
  const estimatedSeconds = isComplex ? "15–45s" : plan.steps.length <= 3 ? "2–6s" : "6–15s";

  const riskLevel: "low" | "medium" | "high" =
    plan.reasoningRoute === "approval_required" || plan.reasoningRoute === "proposal_required"
      ? "high"
      : plan.reasoningRoute === "inspect_first" || plan.reasoningRoute === "plan_first"
      ? "medium"
      : "low";

  return NextResponse.json({
    intent: plan.intent,
    intentLabel: intentLabels[plan.intent] ?? plan.intent,
    reasoningRoute: plan.reasoningRoute,
    routeLabel: routeLabels[plan.reasoningRoute] ?? plan.reasoningRoute,
    steps: plan.steps,
    estimatedTime: estimatedSeconds,
    riskLevel,
    forcedTool: plan.forcedToolName,
  });
}
