/**
 * Rune Hands — Phase 1: Approval-Gated Action Executor
 *
 * Every sensitive action (code changes, deployments, PRs, merges, customer
 * messages, financial actions) must flow through this module:
 *
 *   1. propose()  — surface Findings + Plan, log "proposed", return proposal id
 *   2. approve()  — Javier sends the gate phrase → mark "approved"
 *   3. execute()  — run the action, log pre/post, mark "executed" or "failed"
 *
 * No external/code/customer/financial action runs outside this flow.
 */

import { getSupabaseClient } from "@/lib/supabase";
import { logActionEvent } from "@/lib/action-events";
import { logError } from "@/lib/errors";

export type HandsActionType =
  | "code_change"
  | "deploy"
  | "pr_open"
  | "pr_merge"
  | "branch_create"
  | "schema_change"
  | "customer_message"
  | "grant_credits"
  | "financial"
  | "revoke_access"
  | "other_sensitive";

export type HandsStatus = "proposed" | "approved" | "executing" | "executed" | "failed" | "cancelled";

export interface HandsProposal {
  id: string;
  action_type: HandsActionType;
  title: string;
  findings: string;
  plan: string;
  gate_phrase: string;
  risk_level: "low" | "medium" | "high";
  status: HandsStatus;
  result_summary: string | null;
  rollback_note: string | null;
  project_key: string;
  session_id: string | null;
  workspace_id: string | null;
  conversation_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  approved_at: string | null;
  executed_at: string | null;
}

export interface ProposeActionInput {
  actionType: HandsActionType;
  title: string;
  findings: string;
  plan: string;
  riskLevel?: "low" | "medium" | "high";
  projectKey?: string;
  rollbackNote?: string;
  sessionId?: string | null;
  workspaceId?: string | null;
  conversationId?: string | null;
  metadata?: Record<string, unknown>;
}

function buildGatePhrase(title: string): string {
  const slug = title.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(" ").slice(0, 5).join(" ");
  return `APPROVE RUNE: ${slug}`;
}

/**
 * Step 1 — Propose an action.
 * Logs findings + plan, returns a proposal record with the required gate phrase.
 */
export async function proposeAction(input: ProposeActionInput): Promise<{
  ok: boolean;
  proposal?: HandsProposal;
  error?: string;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const gatePhrase = buildGatePhrase(input.title);

  const row = {
    action_type: input.actionType,
    title: input.title.slice(0, 200),
    findings: input.findings.slice(0, 2000),
    plan: input.plan.slice(0, 2000),
    gate_phrase: gatePhrase,
    risk_level: input.riskLevel ?? "medium",
    status: "proposed" as HandsStatus,
    result_summary: null,
    rollback_note: input.rollbackNote?.slice(0, 500) ?? null,
    project_key: (input.projectKey ?? "global").slice(0, 80),
    session_id: input.sessionId ?? null,
    workspace_id: input.workspaceId ?? null,
    conversation_id: input.conversationId ?? null,
    metadata: input.metadata ?? {},
  };

  const { data, error } = await supabase
    .from("rune_hands_proposals")
    .insert(row)
    .select()
    .single();

  if (error || !data) {
    await logError({ context: "hands.proposeAction", message: error?.message ?? "Insert failed" });
    return { ok: false, error: error?.message ?? "Failed to store proposal." };
  }

  await logActionEvent({
    eventType: `hands.proposed.${input.actionType}`,
    summary: `Proposed: ${input.title}`,
    status: "proposed",
    approvalStage: "plan",
    riskLevel: input.riskLevel ?? "medium",
    projectKey: input.projectKey,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    metadata: { proposalId: data.id, gatePhrase },
  });

  return { ok: true, proposal: data as HandsProposal };
}

/**
 * Step 2 — Approve a proposal.
 * Called after Javier confirms with the gate phrase.
 */
export async function approveProposal(proposalId: string): Promise<{
  ok: boolean;
  proposal?: HandsProposal;
  error?: string;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const { data, error } = await supabase
    .from("rune_hands_proposals")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("status", "proposed")
    .select()
    .single();

  if (error || !data) {
    return { ok: false, error: "Proposal not found or already processed." };
  }

  await logActionEvent({
    eventType: `hands.approved.${data.action_type}`,
    summary: `Approved: ${data.title}`,
    status: "approved",
    approvalStage: "approval",
    riskLevel: data.risk_level,
    projectKey: data.project_key,
    sessionId: data.session_id,
    workspaceId: data.workspace_id,
    conversationId: data.conversation_id,
    metadata: { proposalId },
  });

  return { ok: true, proposal: data as HandsProposal };
}

/**
 * Step 3 — Execute an approved proposal.
 * Runs the provided executor function, logs pre/post, marks executed or failed.
 */
export async function executeProposal<T>(
  proposalId: string,
  executor: () => Promise<{ ok: boolean; result: T; summary: string }>
): Promise<{ ok: boolean; result?: T; summary?: string; error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  // Verify approved
  const { data: proposal } = await supabase
    .from("rune_hands_proposals")
    .select()
    .eq("id", proposalId)
    .single();

  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.status !== "approved") {
    return { ok: false, error: `Cannot execute — proposal status is '${proposal.status}'.` };
  }

  // Mark executing
  await supabase
    .from("rune_hands_proposals")
    .update({ status: "executing" })
    .eq("id", proposalId);

  await logActionEvent({
    eventType: `hands.executing.${proposal.action_type}`,
    summary: `Executing: ${proposal.title}`,
    status: "approved",
    approvalStage: "action",
    riskLevel: proposal.risk_level,
    projectKey: proposal.project_key,
    sessionId: proposal.session_id,
    workspaceId: proposal.workspace_id,
    conversationId: proposal.conversation_id,
    metadata: { proposalId },
  });

  try {
    const { ok, result, summary } = await executor();

    await supabase
      .from("rune_hands_proposals")
      .update({
        status: ok ? "executed" : "failed",
        result_summary: summary.slice(0, 1000),
        executed_at: new Date().toISOString(),
      })
      .eq("id", proposalId);

    await logActionEvent({
      eventType: ok ? `hands.executed.${proposal.action_type}` : `hands.failed.${proposal.action_type}`,
      summary: ok ? `Executed: ${proposal.title}` : `Failed: ${proposal.title} — ${summary}`,
      status: ok ? "executed" : "failed",
      approvalStage: "complete",
      riskLevel: proposal.risk_level,
      projectKey: proposal.project_key,
      sessionId: proposal.session_id,
      workspaceId: proposal.workspace_id,
      conversationId: proposal.conversation_id,
      metadata: { proposalId, resultSummary: summary },
    });

    return { ok, result, summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("rune_hands_proposals")
      .update({ status: "failed", result_summary: msg.slice(0, 1000), executed_at: new Date().toISOString() })
      .eq("id", proposalId);

    await logActionEvent({
      eventType: `hands.failed.${proposal.action_type}`,
      summary: `Failed: ${proposal.title} — ${msg}`,
      status: "failed",
      approvalStage: "complete",
      riskLevel: proposal.risk_level,
      projectKey: proposal.project_key,
      sessionId: proposal.session_id,
      workspaceId: proposal.workspace_id,
      conversationId: proposal.conversation_id,
      metadata: { proposalId, error: msg },
    });

    return { ok: false, error: msg };
  }
}

/**
 * List recent proposals for display in the Operator Console.
 */
export async function listHandsProposals(limit = 20): Promise<HandsProposal[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("rune_hands_proposals")
    .select()
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as HandsProposal[];
}

/**
 * Get a single proposal by ID.
 */
export async function getHandsProposal(proposalId: string): Promise<HandsProposal | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("rune_hands_proposals")
    .select()
    .eq("id", proposalId)
    .single();
  return data as HandsProposal | null;
}
// built: 1779148617
