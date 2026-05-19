import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/errors";

export type ActionEventStatus = "proposed" | "approved" | "executed" | "blocked" | "failed" | "info";
export type ActionApprovalStage = "none" | "findings" | "plan" | "approval" | "action" | "complete";
export type ActionRiskLevel = "low" | "medium" | "high";

export interface ActionEventInput {
  eventType: string;
  summary: string;
  status?: ActionEventStatus;
  approvalStage?: ActionApprovalStage;
  riskLevel?: ActionRiskLevel;
  projectKey?: string | null;
  sessionId?: string | null;
  workspaceId?: string | null;
  conversationId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ActionEventRow {
  id: string;
  event_type: string;
  summary: string;
  status: ActionEventStatus;
  approval_stage: ActionApprovalStage;
  risk_level: ActionRiskLevel;
  project_key: string;
  session_id: string | null;
  workspace_id: string | null;
  conversation_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const VALID_STATUSES: ActionEventStatus[] = ["proposed", "approved", "executed", "blocked", "failed", "info"];
const VALID_STAGES: ActionApprovalStage[] = ["none", "findings", "plan", "approval", "action", "complete"];
const VALID_RISKS: ActionRiskLevel[] = ["low", "medium", "high"];

function cleanText(value: unknown, maxChars = 500) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function normalizeProjectKey(value: unknown) {
  const cleaned = cleanText(value, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "global";
}

function normalizeStatus(value: unknown): ActionEventStatus {
  return VALID_STATUSES.includes(value as ActionEventStatus) ? (value as ActionEventStatus) : "info";
}

function normalizeStage(value: unknown): ActionApprovalStage {
  return VALID_STAGES.includes(value as ActionApprovalStage) ? (value as ActionApprovalStage) : "none";
}

function normalizeRisk(value: unknown): ActionRiskLevel {
  return VALID_RISKS.includes(value as ActionRiskLevel) ? (value as ActionRiskLevel) : "low";
}

export async function logActionEvent(input: ActionEventInput) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const eventType = cleanText(input.eventType, 120);
  const summary = cleanText(input.summary, 500);
  if (!eventType || !summary) return { ok: false, error: "Action event type and summary are required." };

  const { data, error } = await supabase
    .from("rune_action_events")
    .insert({
      event_type: eventType,
      summary,
      status: normalizeStatus(input.status),
      approval_stage: normalizeStage(input.approvalStage),
      risk_level: normalizeRisk(input.riskLevel),
      project_key: normalizeProjectKey(input.projectKey),
      session_id: input.sessionId ? cleanText(input.sessionId, 120) : null,
      workspace_id: input.workspaceId || null,
      conversation_id: input.conversationId || null,
      metadata: input.metadata ?? {},
    })
    .select("id, event_type, summary, status, approval_stage, risk_level, project_key, session_id, workspace_id, conversation_id, metadata, created_at")
    .single();

  if (error) {
    logError("actionEvents.logActionEvent", error);
    return { ok: false, error: error.message };
  }

  return { ok: true, event: data as ActionEventRow };
}

export async function listActionEvents(options: {
  projectKey?: string | null;
  sessionId?: string | null;
  limit?: number;
} = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) return [] as ActionEventRow[];

  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  let request = supabase
    .from("rune_action_events")
    .select("id, event_type, summary, status, approval_stage, risk_level, project_key, session_id, workspace_id, conversation_id, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options.projectKey) {
    request = request.in("project_key", ["global", normalizeProjectKey(options.projectKey)]);
  }

  if (options.sessionId) {
    request = request.eq("session_id", cleanText(options.sessionId, 120));
  }

  const { data, error } = await request;
  if (error) {
    logError("actionEvents.listActionEvents", error);
    return [] as ActionEventRow[];
  }

  return (data ?? []) as ActionEventRow[];
}
