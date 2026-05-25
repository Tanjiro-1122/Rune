"use client";
import { useState, useEffect, useCallback, useRef, RefObject } from "react";
import { useRouter } from "next/navigation";

const PROJECTS = [
  { key: "rune",    label: "Rune",          repo: "Tanjiro-1122/Rune",                  tag: "OWNER-CONSOLE",        color: "#c0392b" },
  { key: "unfiltr", label: "Unfiltr",        repo: "Tanjiro-1122/unfiltrbyjavierbackup", tag: "SENSITIVE PRODUCTION", color: "#e67e22" },
  { key: "swh",     label: "SWH",            repo: "Tanjiro-1122/swhmobile",             tag: "PRODUCTION APP",       color: "#27ae60" },
  { key: "family",  label: "Unfiltr Family", repo: "Tanjiro-1122/UnfiltrFamily",         tag: "SENSITIVE PRODUCTION", color: "#8e44ad" },
];

const NAV = [
  { id: "home",     icon: "⌘", label: "Command center" },
  { id: "repo",     icon: "⎇", label: "Repo control"   },
  { id: "tasks",    icon: "✓", label: "Tasks"           },
  { id: "memory",   icon: "◈", label: "Memory"          },
  { id: "deploy",   icon: "↑", label: "Deploy"          },
  { id: "activity", icon: "≋", label: "Activity"        },
];

const PANEL_LABELS: Record<string, string> = {
  home: "Command center", repo: "Repo control", tasks: "Tasks",
  memory: "Memory", deploy: "Deploy health", activity: "Activity",
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  proposed: { bg: "#1a1a1a", color: "#888" },
  approved:  { bg: "#1f1a08", color: "#f59e0b" },
  executed:  { bg: "#0d1f0d", color: "#4ade80" },
  blocked:   { bg: "#200d0d", color: "#c0392b" },
  rejected:  { bg: "#1a1010", color: "#666" },
  cancelled: { bg: "#111",    color: "#444" },
};

const EVENT_ICONS: Record<string, string> = {
  "repo_action.pr_opened":    "⎇",
  "repo_action.executed":     "✓",
  "repo_action.proposed":     "○",
  "deploy":                   "↑",
  "task.completed":           "✓",
  "task.failed":              "!",
  "error":                    "!",
  "info":                     "i",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Inline approval button (Step 4) ────────────────────────────────────────
function InlineApprovalButton({ proposalId, onApproved }: { proposalId: string; onApproved?: () => void }) {
  const [state, setState] = useState<"idle"|"loading"|"done"|"error">("idle");

  async function approve() {
    setState("loading");
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: proposalId, code: "1122" }),
      });
      if (res.ok) { setState("done"); onApproved?.(); }
      else setState("error");
    } catch { setState("error"); }
  }

  if (state === "done") return (
    <div style={{ fontSize:10, color:"#4ade80", marginTop:4 }}>✓ Approved — PR opening...</div>
  );
  return (
    <button onClick={approve} disabled={state === "loading"} style={{
      marginTop:5, background: state === "loading" ? "#333" : "#c0392b",
      color:"#fff", border:"none", borderRadius:5, padding:"4px 12px",
      fontSize:10, cursor: state === "loading" ? "default" : "pointer", fontFamily:"inherit",
    }}>
      {state === "loading" ? "Approving…" : state === "error" ? "Try again" : "✓ Approve"}
    </button>
  );
}

// ── Repo panel ──────────────────────────────────────────────────────────────
function RepoPanel({ activeProject }: { activeProject: string }) {
  const [proposals, setProposals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const proj = PROJECTS.find(p => p.key === activeProject);

  useEffect(() => {
    setLoading(true);
    fetch("/api/repo-actions?limit=50")
      .then(r => r.ok ? r.json() : { proposals: [] })
      .then(d => {
        const all: any[] = d.proposals ?? [];
        // Fix 4: filter by active project's repo when a specific project is selected
        const filtered = proj?.repo ? all.filter((p: any) => p?.repo === proj.repo) : all;
        setProposals(filtered.slice(0, 20));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [activeProject]);

  if (loading) return <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:11 }}>Loading proposals…</div>;
  if (!proposals.length) return <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:11 }}>No proposals yet.</div>;

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"14px 20px" }}>
      <div style={{ fontSize:9, color:"#333", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>Repo proposals</div>
      {proposals.map((p: any) => {
        const sc = STATUS_COLORS[p.status] ?? STATUS_COLORS.proposed;
        return (
          <div key={p.id} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"9px 0", borderBottom:"1px solid #141414" }}>
            <span style={{ fontSize:9, padding:"2px 7px", borderRadius:10, background:sc.bg, color:sc.color, border:`1px solid ${sc.color}44`, flexShrink:0, marginTop:2 }}>{p.status}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, color:"#ccc", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.title}</div>
              {p.draft_metadata?.pr_url && (
                <a href={p.draft_metadata.pr_url} target="_blank" rel="noreferrer" style={{ fontSize:10, color:"#4ade80", marginTop:2, display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.draft_metadata.pr_url}</a>
              )}
              {(p.status === "proposed" || (p.status === "approved" && !p.draft_metadata?.pr_url)) && (
                <InlineApprovalButton proposalId={p.id} onApproved={() => setProposals(prev => prev.filter(x => x.id !== p.id))} />
              )}
            </div>
            <div style={{ fontSize:9, color:"#333", flexShrink:0, paddingTop:2 }}>{timeAgo(p.updated_at)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Activity panel ──────────────────────────────────────────────────────────
function ActivityPanel() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/actions?limit=8")
      .then(r => r.json())
      .then(d => {
        // Filter: exclude noisy file upload events — show only meaningful signal
        const EXCLUDED = ["workspace_file.uploaded", "workspace_file.created"];
        const events: any[] = Array.isArray(d?.events) ? d.events : [];
        setEvents(events.filter((e: any) => !EXCLUDED.includes(e?.event_type ?? "")));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:11 }}>Loading activity…</div>;
  if (!events.length) return <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:11 }}>No events yet.</div>;

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"14px 20px" }}>
      <div style={{ fontSize:9, color:"#333", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>Activity log</div>
      {events.map((ev: any, i: number) => {
        const icon = EVENT_ICONS[ev.event_type] ?? "·";
        const isError = ev.status === "failed" || ev.event_type === "error";
        const iconColor = isError ? "#c0392b" : ev.status === "executed" ? "#4ade80" : "#60a5fa";
        return (
          <div key={ev.id ?? i} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"9px 0", borderBottom:"1px solid #141414" }}>
            <div style={{ width:28, height:28, borderRadius:6, flexShrink:0, background:isError?"#200d0d":"#0d1520", color:iconColor, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, marginTop:1 }}>{icon}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, color:"#ccc", fontWeight:500 }}>{ev.summary}</div>
              <div style={{ fontSize:10, color:"#444", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{ev.event_type}{ev.project_key ? ` · ${ev.project_key}` : ""}</div>
            </div>
            <div style={{ fontSize:9, color:"#333", flexShrink:0, paddingTop:2 }}>{timeAgo(ev.created_at)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tasks panel ─────────────────────────────────────────────────────────────
function TasksPanel({ project }: { project: string }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Fix 4: bypass /api/tasks — use /api/tasks-direct which queries Supabase directly
    fetch("/api/tasks-direct")
      .then(r => r.ok ? r.json() : Promise.reject(`tasks-direct ${r.status}`))
      .then(d => {
        console.log("[TasksPanel] /api/tasks-direct response:", d);
        const rows: any[] = Array.isArray(d) ? d
                          : Array.isArray(d?.tasks) ? d.tasks
                          : [];
        setTasks(rows);
      })
      .catch(e => { console.warn("[TasksPanel] fetch failed:", e); setTasks([]); })
      .finally(() => setLoading(false));
  }, [project]);

  const knownStatuses = ["running", "completed", "failed"];
  const groups = {
    running:   tasks.filter(t => t?.status === "running"),
    completed: tasks.filter(t => t?.status === "completed"),
    failed:    tasks.filter(t => t?.status === "failed"),
    other:     tasks.filter(t => !knownStatuses.includes(t?.status ?? "")),
  };

  const statusColor: Record<string, string> = {
    running: "#f59e0b", completed: "#4ade80", failed: "#c0392b", other: "#60a5fa",
  };

  if (loading) return (
    <div style={{ padding:"20px", color:"#444", fontSize:12 }}>Loading tasks...</div>
  );

  if (!tasks.length) return (
    <div style={{ padding:"20px", color:"#444", fontSize:12 }}>No tasks yet.</div>
  );

  return (
    <div style={{ padding:"14px 16px" }}>
      {(["running", "completed", "failed", "other"] as const).map(group => (
        groups[group].length > 0 && (
          <div key={group} style={{ marginBottom:20 }}>
            <div style={{ fontSize:9, color:"#444", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8 }}>
              {group} ({groups[group].length})
            </div>
            {groups[group].map((task: any, i: number) => (
              <div key={task?.id || i} style={{
                padding:"10px 0", borderBottom:"1px solid #1a1a1a",
                display:"flex", alignItems:"flex-start", gap:10
              }}>
                <div style={{
                  width:8, height:8, borderRadius:"50%", flexShrink:0, marginTop:4,
                  background: statusColor[group] || "#555"
                }} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, color:"#ccc", fontWeight:500 }}>
                    {task?.title || "Untitled task"}
                  </div>
                  {task?.result_summary && (
                    <div style={{ fontSize:10, color:"#555", marginTop:2 }}>
                      {task.result_summary}
                    </div>
                  )}
                  {task?.progress != null && task.status === "running" && (
                    <div style={{ marginTop:6, height:2, background:"#222", borderRadius:2 }}>
                      <div style={{ width:`${task.progress}%`, height:"100%", background:"#f59e0b", borderRadius:2 }} />
                    </div>
                  )}
                </div>
                <div style={{ fontSize:9, color:"#444", flexShrink:0 }}>
                  {task?.created_at ? new Date(task.created_at).toLocaleDateString() : ""}
                </div>
              </div>
            ))}
          </div>
        )
      ))}
    </div>
  );
}

// ── Memory panel ────────────────────────────────────────────────────────────
function MemoryPanel() {
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/memory?limit=10")
      .then(r => r.json())
      .then(d => { setMemories(d.memories ?? d ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:11 }}>Loading memory…</div>;
  if (!memories.length) return <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:11 }}>No memory entries yet.</div>;

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"14px 20px" }}>
      <div style={{ fontSize:9, color:"#333", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>Memory entries</div>
      {memories.map((m: any, i: number) => (
        <div key={m.id ?? i} style={{ padding:"9px 0", borderBottom:"1px solid #141414" }}>
          <div style={{ fontSize:11, color:"#aaa", lineHeight:1.5 }}>{m.content ?? m.summary ?? m.text ?? JSON.stringify(m)}</div>
          <div style={{ fontSize:9, color:"#333", marginTop:4 }}>{timeAgo(m.created_at)}</div>
        </div>
      ))}
    </div>
  );
}

// ── Deploy panel ────────────────────────────────────────────────────────────
function DeployPanel() {
  const [deploy, setDeploy] = useState<any>(null);
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/deploy-health")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setDeploy(d); setLoading(false); })
      .catch(() => { setErr(true); setLoading(false); });
  }, []);

  if (loading) return (
    <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:11 }}>Checking deploy…</div>
  );
  if (err || !deploy) return (
    <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:11 }}>Deploy health unavailable</div>
  );

  // Fix 3: /api/deploy-health returns { overall, generatedAt, checks:[{key,label,status,detail}] }
  const overall = deploy?.overall ?? "—";
  const overallColor = overall === "ok" ? "#4ade80" : overall === "warning" ? "#f59e0b" : overall === "error" ? "#c0392b" : "#555";
  const checks: any[] = Array.isArray(deploy?.checks) ? deploy.checks : [];
  const generatedAt = deploy?.generatedAt ?? null;

  // Key signals to surface at top
  const keyChecks = [
    checks.find((ch: any) => ch.key === "vercel.intelligence"),
    checks.find((ch: any) => ch.key === "github.intelligence"),
    checks.find((ch: any) => ch.key === "supabase.connection"),
  ].filter(Boolean);

  const missingChecks = checks.filter((ch: any) => ch.status === "missing" || ch.status === "error");
  const okCount = checks.filter((ch: any) => ch.status === "ok").length;

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"14px 20px" }}>
      {/* Overall status */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:"1px solid #1e1e1e", marginBottom:4 }}>
        <span style={{ fontSize:11, color:"#555" }}>Overall</span>
        <span style={{ fontSize:13, fontWeight:700, color:overallColor, textTransform:"uppercase" }}>{overall}</span>
      </div>
      {generatedAt && (
        <div style={{ fontSize:9, color:"#333", marginBottom:14 }}>Checked {timeAgo(generatedAt)}</div>
      )}

      {/* Key signals */}
      {keyChecks.length > 0 && (
        <>
          <div style={{ fontSize:9, color:"#333", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>Signals</div>
          {keyChecks.map((ch: any) => (
            <div key={ch.key} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"7px 0", borderBottom:"1px solid #141414", gap:8 }}>
              <span style={{ fontSize:10, color:"#888", flexShrink:0 }}>{ch.label}</span>
              <span style={{ fontSize:10, color: ch.status==="ok" ? "#4ade80" : "#c0392b", textAlign:"right", maxWidth:"60%" }}>{ch.detail}</span>
            </div>
          ))}
        </>
      )}

      {/* Health summary */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:"1px solid #141414", marginTop:8 }}>
        <span style={{ fontSize:11, color:"#555" }}>Checks passing</span>
        <span style={{ fontSize:11, color:"#4ade80" }}>{okCount} / {checks.length}</span>
      </div>

      {/* Issues */}
      {missingChecks.length > 0 && (
        <>
          <div style={{ fontSize:9, color:"#c0392b", letterSpacing:"0.1em", textTransform:"uppercase", marginTop:14, marginBottom:8 }}>Issues</div>
          {missingChecks.map((ch: any) => (
            <div key={ch.key} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"7px 0", borderBottom:"1px solid #141414", gap:8 }}>
              <span style={{ fontSize:10, color:"#c0392b", flexShrink:0 }}>{ch.label}</span>
              <span style={{ fontSize:10, color:"#555", textAlign:"right", maxWidth:"60%" }}>{ch.detail}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Stat cards with live data ───────────────────────────────────────────────
function useStats() {
  const [stats, setStats] = useState({ openPRs: "—", lastDeploy: "—", pendingApproval: "—", tokenExpiry: "✓ no expiry" });

  useEffect(() => {
    // Fetch proposals for PR counts
    fetch("/api/repo-actions?limit=50")
      .then(r => { if (!r.ok) throw new Error(`repo-actions ${r.status}`); return r.json(); })
      .then(d => {
        const proposals: any[] = Array.isArray(d?.proposals) ? d.proposals : [];
        const openPRs = proposals.filter((p: any) => p?.status === "proposed" || p?.status === "approved").length;
        const pendingApproval = proposals.filter((p: any) => p?.status === "approved" && !p?.draft_metadata?.pr_url).length;
        setStats(prev => ({ ...prev, openPRs: String(openPRs), pendingApproval: String(pendingApproval) }));
      })
      .catch(() => {});

    // Fetch last deploy from /api/deploy-health
    fetch("/api/deploy-health")
      .then(r => { if (!r.ok) throw new Error(`deploy-health ${r.status}`); return r.json(); })
      .then(d => {
        const state = d?.deployment?.readyState ?? d?.state ?? null;
        setStats(prev => ({ ...prev, lastDeploy: state === "READY" ? "✓ live" : state ?? "—" }));
      })
      .catch(() => setStats(prev => ({ ...prev, lastDeploy: "—" })));

    // Fix 1: token expiry hardcoded — re-enable dynamic check in future session
  }, []);

  return stats;
}


// ── Mobile layout — full-screen, bottom-nav shell ──────────────────────────
function RuneMobileLayout({
  activeNav, setActiveNav,
  activeProject, setActiveProject,
  input, setInput,
  chatMessages, chatSending, chatError,
  sendChat, chatEndRef,
  pulseOn, stats,
  activityFeed,
}: {
  activeNav: string; setActiveNav: (n: string) => void;
  activeProject: string; setActiveProject: (p: string) => void;
  input: string; setInput: (v: string) => void;
  chatMessages: Array<{role:"user"|"assistant";content:string}>;
  chatSending: boolean; chatError: string|null;
  sendChat: () => void;
  chatEndRef: RefObject<HTMLDivElement | null>;
  pulseOn: boolean;
  stats: { openPRs:string; lastDeploy:string; pendingApproval:string; tokenExpiry:string };
  activityFeed: any[];
}) {
  function renderPanel() {
    switch (activeNav) {
      case "repo":     return <RepoPanel activeProject={activeProject} />;
      case "tasks":    return <TasksPanel project={activeProject} />;
      case "memory":   return <MemoryPanel />;
      case "deploy":   return <DeployPanel />;
      case "activity": return <ActivityPanel />;
      default:         return (
        <>
          {/* Stat cards */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, padding:"12px 14px", borderBottom:"1px solid #141414" }}>
            {[
              { label:"Open PRs",         value: stats.openPRs,        color:"#e8e8e8" },
              { label:"Last deploy",      value: stats.lastDeploy,     color:"#27ae60" },
              { label:"Pending",          value: stats.pendingApproval, color:"#f59e0b" },
              { label:"Token expiry",     value: stats.tokenExpiry,    color: stats.tokenExpiry.startsWith("✓") ? "#27ae60" : "#c0392b" },
            ].map(s => (
              <div key={s.label} style={{ background:"#111", border:"1px solid #1e1e1e", borderRadius:7, padding:"8px 10px" }}>
                <div style={{ fontSize:9, color:"#444", marginBottom:4, letterSpacing:"0.06em", textTransform:"uppercase" }}>{s.label}</div>
                <div style={{ fontSize:17, fontWeight:600, color:s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          {/* Live activity feed */}
          <div style={{ flex:1, overflowY:"auto", padding:"12px 14px" }}>
            <div style={{ fontSize:9, color:"#333", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>Recent activity</div>
            {activityFeed.length === 0 && <div style={{ color:"#333", fontSize:11 }}>No activity yet.</div>}
            {activityFeed.map((ev: any, i: number) => {
              const icon = EVENT_ICONS[ev.event_type] ?? "·";
              const isErr = ev.status==="failed" || ev.event_type==="error";
              return (
                <div key={ev.id ?? i} style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"8px 0", borderBottom:"1px solid #141414" }}>
                  <div style={{ width:26, height:26, borderRadius:5, flexShrink:0, background:isErr?"#200d0d":"#0d1520", color:isErr?"#c0392b":"#60a5fa", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12 }}>{icon}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11, color:"#ccc", fontWeight:500 }}>{ev.summary}</div>
                    <div style={{ fontSize:10, color:"#444", marginTop:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{ev.event_type}{ev.project_key ? ` · ${ev.project_key}` : ""}</div>
                  </div>
                  <div style={{ fontSize:9, color:"#333", flexShrink:0, paddingTop:2 }}>{timeAgo(ev.created_at)}</div>
                </div>
              );
            })}
          </div>
        </>
      );
    }
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", minHeight:"100dvh", height:"100dvh", background:"#0a0a0a", fontFamily:"'JetBrains Mono','Fira Code',monospace", color:"#d4d4d4", overflow:"hidden", paddingBottom:"calc(env(safe-area-inset-bottom, 20px) + 60px)" }}>
      {/* Header */}
      <div style={{ background:"#080808", borderBottom:"1px solid #1a1a1a", display:"flex", flexDirection:"column", flexShrink:0, paddingTop:"env(safe-area-inset-top, 44px)" }}>
        <div style={{ display:"flex", alignItems:"center", padding:"0 14px", gap:10, height:38 }}>
          <div style={{ width:22, height:22, borderRadius:5, background:"#111", border:"1px solid #2a2a2a", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, color:"#c0392b", fontWeight:700 }}>R</div>
          <span style={{ fontSize:11, fontWeight:600, color:"#e8e8e8", letterSpacing:"0.05em" }}>RUNE</span>
          <span style={{ fontSize:9, color:"#333" }}>command center</span>
          <div style={{ display:"flex", alignItems:"center", gap:5, marginLeft:"auto" }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background: pulseOn ? "#27ae60" : "#1a6b35", transition:"background 0.4s" }} />
          </div>
        </div>
        {/* Project pills scroll row */}
        <div style={{ padding:"6px 14px 2px" }}>
          <div style={{ fontSize:9, color:"#333", letterSpacing:"0.1em", textTransform:"uppercase" }}>Project</div>
        </div>
        <div style={{ display:"flex", gap:6, overflowX:"auto", padding:"4px 14px 8px", scrollbarWidth:"none" } as React.CSSProperties}>
          {PROJECTS.map(p => (
            <button key={p.key} onClick={() => setActiveProject(p.key)}
              style={{ fontSize:10, padding:"3px 10px", borderRadius:20, border: activeProject===p.key ? `1px solid ${p.color}` : "1px solid #222", background: activeProject===p.key ? p.color+"22" : "transparent", color: activeProject===p.key ? p.color : "#555", cursor:"pointer", fontFamily:"inherit", flexShrink:0, whiteSpace:"nowrap" }}
            >{p.label}</button>
          ))}
        </div>
      </div>

      {/* Panel header */}
      <div style={{ padding:"10px 14px", borderBottom:"1px solid #141414", display:"flex", alignItems:"center", gap:8, background:"#0e0e0e", flexShrink:0 }}>
        <span style={{ color:"#c0392b", fontSize:14 }}>{NAV.find(n => n.id===activeNav)?.icon ?? "⌘"}</span>
        <span style={{ fontSize:12, fontWeight:600, color:"#e8e8e8" }}>{PANEL_LABELS[activeNav]}</span>
      </div>

      {/* Scrollable main panel */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", background:"#0e0e0e" }}>
        {renderPanel()}
      </div>

      {/* Chat thread */}
      {chatMessages.length > 0 && (
        <div style={{ maxHeight:200, overflowY:"auto", padding:"8px 14px", background:"#090909", borderTop:"1px solid #141414", flexShrink:0 }}>
          {chatMessages.map((m, i) => (
            <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:m.role==="user"?"flex-end":"flex-start", marginBottom:5 }}>
              <div style={{ maxWidth:"85%", padding:"5px 9px", borderRadius:7, fontSize:11, lineHeight:1.55,
                background: m.role==="user" ? "#1e0a0a" : "#111",
                color: m.role==="user" ? "#e8e8e8" : "#bbb",
                border: m.role==="user" ? "1px solid #c0392b44" : "1px solid #1e1e1e",
                whiteSpace:"pre-wrap", wordBreak:"break-word"
              }}>{m.content}</div>
            </div>
          ))}
          {chatSending && <div style={{ padding:"5px 9px", borderRadius:7, fontSize:11, background:"#111", color:"#555", border:"1px solid #1e1e1e", display:"inline-block" }}>…</div>}
          {chatError && <div style={{ fontSize:10, color:"#c0392b", padding:"2px 4px" }}>{chatError}</div>}
          <div ref={chatEndRef} />
        </div>
      )}

      {/* Chat bar */}
      <div style={{ borderTop:"1px solid #141414", padding:"10px 14px", paddingBottom:"calc(10px + env(safe-area-inset-bottom, 0px))", display:"flex", alignItems:"center", gap:8, background:"#090909", flexShrink:0 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey && !chatSending) { e.preventDefault(); sendChat(); } }}
          placeholder="Ask Rune anything…"
          style={{ flex:1, background:"#111", border:"1px solid #1e1e1e", borderRadius:6, padding:"7px 11px", fontSize:11, color:"#d4d4d4", outline:"none", fontFamily:"inherit" }}
        />
        <button
          onClick={sendChat}
          disabled={chatSending || !input.trim()}
          style={{ width:30, height:30, borderRadius:6, background: chatSending||!input.trim() ? "#3a1010" : "#c0392b", border:"none", color:"#fff", cursor: chatSending||!input.trim() ? "not-allowed" : "pointer", fontSize:14 }}
        >↑</button>
      </div>

      {/* Bottom nav */}
      <div style={{ borderTop:"1px solid #141414", display:"flex", background:"#080808", paddingBottom:"env(safe-area-inset-bottom, 20px)", flexShrink:0, position:"sticky" as const, bottom:0 }}>
        {NAV.map(n => (
          <button key={n.id} onClick={() => setActiveNav(n.id)}
            style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2, padding:"8px 0", border:"none", background:"transparent", color: activeNav===n.id ? "#c0392b" : "#3a3a3a", cursor:"pointer", fontFamily:"inherit" }}
          >
            <span style={{ fontSize:16 }}>{n.icon}</span>
            <span style={{ fontSize:8, letterSpacing:"0.05em" }}>{n.label.split(" ")[0].toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Root component ──────────────────────────────────────────────────────────
export default function RuneCommandCenter() {
  const router = useRouter();
  const [activeNav, setActiveNav]         = useState("home");
  const [activeProject, setActiveProject] = useState("rune");
  const [input, setInput]                 = useState("");
  const [pulseOn, setPulseOn]             = useState(true);
  const [activityFeed, setActivityFeed]   = useState<any[]>([]);
  const [isMobile, setIsMobile]           = useState(false);
  const stats = useStats();
  // Chat bar state
  const [chatMessages, setChatMessages]   = useState<Array<{role:"user"|"assistant"; content:string}>>([]);
  const [chatSending, setChatSending]     = useState(false);
  const [chatError, setChatError]         = useState<string|null>(null);
  const chatEndRef                        = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setPulseOn(p => !p), 1200);
    return () => clearInterval(t);
  }, []);

  // Step 6: Poll /api/notify every 30s for PR merge toasts
  const [toasts, setToasts] = useState<Array<{id:string;title:string;body:string;type:string}>>([]);
  const lastNotifyCheck = useRef<string>(new Date().toISOString());
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`/api/notify?since=${lastNotifyCheck.current}`);
        if (!r.ok) return;
        const d = await r.json();
        const items: any[] = Array.isArray(d?.items) ? d.items : [];
        if (items.length) {
          lastNotifyCheck.current = new Date().toISOString();
          setToasts(prev => [...prev, ...items.map((n: any) => ({
            id: n.id ?? String(Date.now()), title: n.title ?? "Rune", body: n.body ?? "", type: n.type ?? "info"
          }))]);
        }
      } catch { /* silent */ }
    };
    poll();
    const t = setInterval(poll, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900);
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  // Home activity feed — live from /api/actions
  useEffect(() => {
    if (activeNav !== "home") return;
    fetch("/api/actions?limit=8")
      .then(r => { if (!r.ok) throw new Error(`actions ${r.status}`); return r.json(); })
      .then(d => {
        const EXCLUDED = ["workspace_file.uploaded", "workspace_file.created"];
        const events: any[] = Array.isArray(d?.events) ? d.events : [];
        setActivityFeed(events.filter((e: any) => !EXCLUDED.includes(e?.event_type ?? "")));
      })
      .catch(() => setActivityFeed([]));
  }, [activeNav]);

  const proj = PROJECTS.find(p => p.key === activeProject)!;

  // ── Chat send ──────────────────────────────────────────────────────────────
  async function sendChat() {
    const text = input.trim();
    if (!text || chatSending) return;
    setInput("");
    setChatError(null);
    const userMsg = { role: "user" as const, content: text };
    setChatMessages(prev => [...prev, userMsg]);
    setChatSending(true);
    try {
      const allMessages = [...chatMessages, userMsg];
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: allMessages }),
      });
      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => "Request failed");
        throw new Error(err.slice(0, 200));
      }
      // Stream the response
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      setChatMessages(prev => [...prev, { role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // AI SDK data stream format: lines like `0:"text chunk"\n`
        for (const line of chunk.split("\n")) {
          if (line.startsWith('0:"')) {
            try {
              const parsed = JSON.parse(line.slice(2));
              assistantContent += parsed;
              setChatMessages(prev => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { role: "assistant", content: assistantContent };
                return msgs;
              });
            } catch { /* partial line, skip */ }
          } else if (line.startsWith("0:")) {
            try {
              const parsed = JSON.parse(line.slice(2));
              if (typeof parsed === "string") {
                assistantContent += parsed;
                setChatMessages(prev => {
                  const msgs = [...prev];
                  msgs[msgs.length - 1] = { role: "assistant", content: assistantContent };
                  return msgs;
                });
              }
            } catch { /* skip */ }
          }
        }
      }
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Chat failed");
      setChatMessages(prev => prev.slice(0, -1)); // remove empty assistant bubble
    } finally {
      setChatSending(false);
    }
  }

  function renderMainContent() {
    switch (activeNav) {
      case "repo":     return <RepoPanel activeProject={activeProject} />;
      case "tasks":    return <TasksPanel project={activeProject} />;
      case "memory":   return <MemoryPanel />;
      case "deploy":   return <DeployPanel />;
      case "activity": return <ActivityPanel />;
      default:         return renderHome();
    }
  }

  function renderHome() {
    return (
      <>
        {/* Stat cards */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, padding:"14px 20px", borderBottom:"1px solid #141414" }}>
          {[
            { label:"Open PRs",         value: stats.openPRs,        color:"#e8e8e8" },
            { label:"Last deploy",      value: stats.lastDeploy,     color:"#27ae60" },
            { label:"Pending approval", value: stats.pendingApproval, color:"#f59e0b" },
            { label:"Token expiry",     value: stats.tokenExpiry,    color: stats.tokenExpiry.startsWith("✓") ? "#27ae60" : "#c0392b" },
          ].map(s => (
            <div key={s.label} style={{ background:"#111", border:"1px solid #1e1e1e", borderRadius:7, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"#444", marginBottom:6, letterSpacing:"0.06em", textTransform:"uppercase" }}>{s.label}</div>
              <div style={{ fontSize:20, fontWeight:600, color:s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Live activity feed */}
        <div style={{ flex:1, overflowY:"auto", padding:"14px 20px" }}>
          <div style={{ fontSize:9, color:"#333", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>Recent activity</div>
          {activityFeed.length === 0 && (
            <div style={{ color:"#333", fontSize:11 }}>No activity yet.</div>
          )}
          {activityFeed.map((ev: any, i: number) => {
            const icon = EVENT_ICONS[ev.event_type] ?? "·";
            const isError = ev.status === "failed" || ev.event_type === "error";
            const iconColor = isError ? "#c0392b" : "#60a5fa";
            return (
              <div key={ev.id ?? i} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"9px 0", borderBottom:"1px solid #141414" }}>
                <div style={{ width:28, height:28, borderRadius:6, flexShrink:0, background:isError?"#200d0d":"#0d1520", color:iconColor, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, marginTop:1 }}>{icon}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11, color:"#ccc", fontWeight:500 }}>{ev.summary}</div>
                  <div style={{ fontSize:10, color:"#444", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{ev.event_type}{ev.project_key ? ` · ${ev.project_key}` : ""}</div>
                </div>
                <div style={{ fontSize:9, color:"#333", flexShrink:0, paddingTop:2 }}>{timeAgo(ev.created_at)}</div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  if (isMobile) return <RuneMobileLayout
    activeNav={activeNav} setActiveNav={setActiveNav}
    activeProject={activeProject} setActiveProject={setActiveProject}
    input={input} setInput={setInput}
    chatMessages={chatMessages} chatSending={chatSending} chatError={chatError}
    sendChat={sendChat} chatEndRef={chatEndRef}
    pulseOn={pulseOn} stats={stats}
    activityFeed={activityFeed}
  />;

  return (
    <div style={{ display:"grid", gridTemplateColumns:"48px 200px 1fr", gridTemplateRows:"44px 1fr", minHeight:"100dvh", height:"100vh", background:"#0a0a0a", fontFamily:"'JetBrains Mono','Fira Code',monospace", color:"#d4d4d4", overflow:"hidden" }}>

      {/* Toast banner — PR merge / system notifications */}
      {toasts.length > 0 && (
        <div style={{ gridColumn:"1 / -1", gridRow:"1 / -1", position:"fixed", top:10, right:16, zIndex:999, display:"flex", flexDirection:"column", gap:6, pointerEvents:"none" }}>
          {toasts.slice(-3).map(t => (
            <div key={t.id} style={{ background: t.type==="success"?"#0d200d":"#1a0d0d", border:`1px solid ${t.type==="success"?"#4ade8044":"#c0392b44"}`, borderRadius:8, padding:"10px 14px", minWidth:240, maxWidth:320, pointerEvents:"all" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <span style={{ fontSize:11, fontWeight:600, color: t.type==="success"?"#4ade80":"#c0392b" }}>{t.title}</span>
                <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} style={{ background:"none", border:"none", color:"#444", cursor:"pointer", fontSize:14, lineHeight:1, padding:0, marginLeft:8 }}>×</button>
              </div>
              {t.body && <div style={{ fontSize:10, color:"#888", marginTop:3 }}>{t.body}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Topbar */}
      <div style={{ gridColumn:"1 / -1", background:"#080808", borderBottom:"1px solid #1a1a1a", display:"flex", alignItems:"center", padding:"0 16px", gap:12 }}>
        <div style={{ width:26, height:26, borderRadius:5, background:"#111", border:"1px solid #2a2a2a", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:"#c0392b", fontWeight:700 }}>R</div>
        <span style={{ fontSize:12, fontWeight:600, color:"#e8e8e8", letterSpacing:"0.05em" }}>RUNE</span>
        <span style={{ fontSize:10, color:"#333", marginLeft:2 }}>command center</span>
        <div style={{ display:"flex", gap:6, marginLeft:"auto" }}>
          {PROJECTS.map(p => (
            <button key={p.key} onClick={() => setActiveProject(p.key)}
              style={{ fontSize:10, padding:"3px 10px", borderRadius:20, border: activeProject===p.key ? `1px solid ${p.color}` : "1px solid #222", background: activeProject===p.key ? p.color+"22" : "transparent", color: activeProject===p.key ? p.color : "#555", cursor:"pointer", fontFamily:"inherit" }}
            >{p.label}</button>
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginLeft:16 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background: pulseOn ? "#27ae60" : "#1a6b35", transition:"background 0.4s" }} />
          <span style={{ fontSize:10, color:"#444" }}>all systems healthy</span>
        </div>

      </div>

      {/* Nav rail */}
      <div style={{ gridRow:2, background:"#080808", borderRight:"1px solid #141414", display:"flex", flexDirection:"column", alignItems:"center", padding:"10px 0", gap:2 }}>
        {NAV.map((n, i) => (
          <div key={n.id}>
            {i === 4 && <div style={{ width:28, height:1, background:"#1e1e1e", margin:"4px 0" }} />}
            <button onClick={() => setActiveNav(n.id)} title={n.label}
              style={{ width:34, height:34, borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", border:"none", background: activeNav===n.id ? "#1e0a0a" : "transparent", color: activeNav===n.id ? "#c0392b" : "#3a3a3a", fontSize:16, fontFamily:"inherit" }}
            >{n.icon}</button>
          </div>
        ))}
        <button onClick={() => router.push("/vault")} title="Settings / Vault"
          style={{ marginTop:"auto", width:34, height:34, borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", border:"none", background:"transparent", color:"#2a2a2a", fontSize:16, fontFamily:"inherit" }}
        >⚙</button>
      </div>

      {/* Sidebar */}
      <div style={{ gridRow:2, background:"#0b0b0b", borderRight:"1px solid #141414", overflowY:"auto", padding:"14px 0" }}>
        {[
          { label:"Repo control", items:[
            { icon:"⎇", text:"Open PRs",        badge: stats.openPRs !== "—" ? stats.openPRs : "—", bc:"#c0392b", onClick: () => setActiveNav("repo")     },
            { icon:"○", text:"Pending approval", badge: stats.pendingApproval !== "—" ? stats.pendingApproval : "—", bc:"#e67e22", onClick: () => setActiveNav("repo") },
            { icon:"✓", text:"Executed",          badge:null, bc:"#333",    onClick: () => setActiveNav("activity") },
          ]},
          { label:"Projects", items: PROJECTS.map(p => ({ icon:"◉", text:p.label, badge:"ok", bc:"#1e6b3a", onClick: () => setActiveProject(p.key) })) },
          { label:"Quick actions", items:[
            { icon:"+", text:"Create file", badge:null, bc:"", onClick: () => setActiveNav("repo")   },
            { icon:"✎", text:"Edit file",   badge:null, bc:"", onClick: () => setActiveNav("repo")   },
            { icon:"↑", text:"Deploy",      badge:null, bc:"", onClick: () => setActiveNav("deploy") },
          ]},
        ].map(section => (
          <div key={section.label} style={{ padding:"0 10px", marginBottom:20 }}>
            <div style={{ fontSize:9, color:"#333", letterSpacing:"0.1em", textTransform:"uppercase", padding:"0 6px", marginBottom:6 }}>{section.label}</div>
            {section.items.map(item => (
              <div key={item.text} onClick={item.onClick}
                style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", borderRadius:5, cursor:"pointer", fontSize:11, color:"#555" }}
              >
                <span style={{ fontSize:13, width:16, textAlign:"center" }}>{item.icon}</span>
                <span style={{ flex:1 }}>{item.text}</span>
                {item.badge && <span style={{ fontSize:9, padding:"1px 6px", borderRadius:10, background:item.bc+"33", color:item.bc==="#333"?"#555":item.bc, border:`1px solid ${item.bc}44` }}>{item.badge}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Main panel */}
      <div style={{ gridRow:2, display:"flex", flexDirection:"column", background:"#0e0e0e", overflow:"hidden" }}>
        <div style={{ padding:"12px 20px", borderBottom:"1px solid #141414", display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ color:"#c0392b", fontSize:15 }}>{NAV.find(n => n.id === activeNav)?.icon ?? "⌘"}</span>
          <span style={{ fontSize:13, fontWeight:600, color:"#e8e8e8" }}>{PANEL_LABELS[activeNav]}</span>
          <span style={{ fontSize:10, color:"#333", marginLeft:"auto" }}>{proj.repo} · main</span>
        </div>
        {renderMainContent()}
        {/* ── Chat thread (only shown when messages exist) */}
        {chatMessages.length > 0 && (
          <div style={{ maxHeight:260, overflowY:"auto", padding:"10px 16px", background:"#090909", borderTop:"1px solid #141414" }}>
            {chatMessages.map((m, i) => (
              <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:m.role==="user"?"flex-end":"flex-start", marginBottom:6 }}>
                <div style={{ maxWidth:"78%", padding:"6px 10px", borderRadius:8, fontSize:11, lineHeight:1.55,
                  background: m.role==="user" ? "#1e0a0a" : "#111",
                  color: m.role==="user" ? "#e8e8e8" : "#bbb",
                  border: m.role==="user" ? "1px solid #c0392b44" : "1px solid #1e1e1e",
                  whiteSpace:"pre-wrap", wordBreak:"break-word"
                }}>{m.content}</div>
              </div>
            ))}
            {chatSending && (
              <div style={{ display:"flex", alignItems:"flex-start", marginBottom:6 }}>
                <div style={{ padding:"6px 10px", borderRadius:8, fontSize:11, background:"#111", color:"#555", border:"1px solid #1e1e1e" }}>…</div>
              </div>
            )}
            {chatError && (
              <div style={{ fontSize:10, color:"#c0392b", padding:"2px 4px" }}>{chatError}</div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}
        <div style={{ borderTop:"1px solid #141414", padding:"10px 16px", paddingBottom:"calc(10px + env(safe-area-inset-bottom, 0px))", display:"flex", alignItems:"center", gap:10, background:"#090909" }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !chatSending) { e.preventDefault(); sendChat(); } }}
            placeholder="Ask Rune anything…"
            style={{ flex:1, background:"#111", border:"1px solid #1e1e1e", borderRadius:6, padding:"7px 12px", fontSize:11, color:"#d4d4d4", outline:"none", fontFamily:"inherit" }}
          />
          <button
            onClick={sendChat}
            disabled={chatSending || !input.trim()}
            style={{ width:30, height:30, borderRadius:6, background: chatSending||!input.trim() ? "#3a1010" : "#c0392b", border:"none", color:"#fff", cursor: chatSending||!input.trim() ? "not-allowed" : "pointer", fontSize:14 }}
          >↑</button>
        </div>

      </div>
    </div>
  );
}
