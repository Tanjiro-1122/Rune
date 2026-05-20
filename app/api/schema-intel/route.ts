import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret, SESSION_COOKIE, verifySessionCookie } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * /api/schema-intel
 * Returns record counts + schema metadata for all known Supabase tables.
 * Powers the Entity/Schema Viewer in the Builder sidebar.
 */

const TABLES = [
  { name: "agent_memories",           label: "Memories",              group: "agent" },
  { name: "agent_memory_events",      label: "Memory events",         group: "agent" },
  { name: "conversations",            label: "Conversations",         group: "workspace" },
  { name: "messages",                 label: "Messages",              group: "workspace" },
  { name: "workspaces",               label: "Workspaces",            group: "workspace" },
  { name: "workspace_documents",      label: "Documents",             group: "workspace" },
  { name: "workspace_artifacts",      label: "Artifacts",             group: "workspace" },
  { name: "workspace_project_files",  label: "Project files",         group: "workspace" },
  { name: "workspace_tasks",          label: "Tasks",                 group: "workspace" },
  { name: "workspace_chunks",         label: "Retrieval chunks",      group: "workspace" },
  { name: "rune_action_events",       label: "Activity log",          group: "system" },
  { name: "jarvis_security_events",   label: "Security events",       group: "system" },
  { name: "jarvis_repo_action_proposals", label: "Repo proposals",    group: "system" },
  { name: "phrourio_vault",           label: "Phrourio Vault",        group: "apps" },
  { name: "unfiltr_user_profiles",    label: "Unfiltr profiles",      group: "apps" },
  { name: "swh_user_profiles",        label: "SWH profiles",          group: "apps" },
  { name: "art_companions",           label: "Art companions",         group: "apps" },
  { name: "unfiltr_journal_entries",  label: "Journal entries",       group: "apps" },
  { name: "unfiltr_mood_entries",     label: "Mood entries",          group: "apps" },
  { name: "unfiltr_chat_history",     label: "Chat history",          group: "apps" },
  { name: "unfiltr_purchase_audit",   label: "Purchase audit",        group: "apps" },
  { name: "unfiltr_tracked_bets",     label: "Tracked bets",          group: "apps" },
];

export interface SchemaTableInfo {
  name: string;
  label: string;
  group: string;
  count: number | null;
  status: "ok" | "missing" | "error";
  error?: string;
}

export interface SchemaIntelSnapshot {
  generatedAt: string;
  connected: boolean;
  tables: SchemaTableInfo[];
}

export async function GET(req: NextRequest) {
  const secret = getSessionSecret();
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie || !secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = await verifySessionCookie(cookie, secret);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      connected: false,
      tables: TABLES.map((t) => ({ ...t, count: null, status: "missing" as const, error: "Supabase not configured" })),
    } satisfies SchemaIntelSnapshot);
  }

  const results = await Promise.all(
    TABLES.map(async (t) => {
      try {
        const { count, error } = await supabase
          .from(t.name)
          .select("*", { count: "exact", head: true });
        if (error) {
          if (error.message.includes("does not exist") || error.code === "42P01") {
            return { ...t, count: null, status: "missing" as const };
          }
          return { ...t, count: null, status: "error" as const, error: error.message };
        }
        return { ...t, count: count ?? 0, status: "ok" as const };
      } catch (err) {
        return { ...t, count: null, status: "error" as const, error: String(err) };
      }
    })
  );

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    connected: true,
    tables: results,
  } satisfies SchemaIntelSnapshot);
}
