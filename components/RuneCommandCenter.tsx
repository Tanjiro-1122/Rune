"use client";
import { useState, useEffect, useCallback } from "react";
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

// ── Repo panel ──────────────────────────────────────────────────────────────
function RepoPanel() {
  const [proposals, setProposals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/repo-actions?limit=10")
      .then(r => r.json())
      .then(d => { setProposals(d.proposals ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

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
      .then(d => { setEvents(d.events ?? []); setLoading(false); })
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
function TasksPanel() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/tasks?limit=30")
      .then(r => r.json())
      .then(d => { setTasks(d.tasks ?? d ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const grouped: Record<string, any[]> = { running: [], completed: [], failed: [] };
  tasks.forEach(t => { (grouped[t.status] ?? grouped.failed).push(t); });

  const GROUP_STYLES: Record<string, { label: string; color: string }> = {
    running:   { label: "Running",   color: "#60a5fa" },
    completed: { label: "Completed", color: "#4ade80" },
    failed:    { label: "Failed",    color: "#c0392b" },
  };

  if (loading) return <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:11 }}>Loading tasks…</div>;

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"14px 20px" }}>
      {Object.entries(GROUP_STYLES).map(([status, { label, color }]) => {
        const group = grouped[status];
        if (!group.length) return null;
        return (
          <div key={status} style={{ marginBottom:18 }}>
            <div style={{ fontSize:9, color, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>{label} · {group.length}</div>
            {group.map((t: any) => (
              <div key={t.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 0", borderBottom:"1px solid #141414" }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11, color:"#ccc", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.title ?? t.summary ?? t.id}</div>
                  <div style={{ fontSize:10, color:"#444", marginTop:1 }}>{timeAgo(t.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
      {!tasks.length && <div style={{ color:"#333", fontSize:11 }}>No tasks yet.</div>}
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
  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:"#333", gap:12 }}>
      <div style={{ fontSize:40 }}>↑</div>
      <div style={{ fontSize:13, color:"#555" }}>Deploy health</div>
      <div style={{ fontSize:11, color:"#333", maxWidth:280, textAlign:"center" }}>Vercel deployment status and health checks.</div>
    </div>
  );
}

// ── Stat cards with live data ───────────────────────────────────────────────
function useStats() {
  const [stats, setStats] = useState({ openPRs: "—", lastDeploy: "—", pendingApproval: "—", tokenExpiry: "2d" });

  useEffect(() => {
    // Fetch proposals for PR counts
    fetch("/api/repo-actions?limit=50")
      .then(r => r.json())
      .then(d => {
        const proposals: any[] = d.proposals ?? [];
        const openPRs = proposals.filter((p: any) => p.status === "proposed" || p.status === "approved").length;
        const pendingApproval = proposals.filter((p: any) => p.status === "approved" && !p.draft_metadata?.pr_url).length;
        setStats(prev => ({ ...prev, openPRs: String(openPRs), pendingApproval: String(pendingApproval) }));
      })
      .catch(() => {});

    // Fetch last deploy from /api/deploy-health
    fetch("/api/deploy-health")
      .then(r => r.json())
      .then(d => {
        const state = d?.deployment?.readyState ?? d?.state ?? null;
        setStats(prev => ({ ...prev, lastDeploy: state === "READY" ? "✓ live" : state ?? "—" }));
      })
      .catch(() => {});
  }, []);

  return stats;
}

// ── Root component ──────────────────────────────────────────────────────────
export default function RuneCommandCenter() {
  const router = useRouter();
  const [activeNav, setActiveNav]         = useState("home");
  const [activeProject, setActiveProject] = useState("rune");
  const [input, setInput]                 = useState("");
  const [pulseOn, setPulseOn]             = useState(true);
  const [activityFeed, setActivityFeed]   = useState<any[]>([]);
  const stats = useStats();

  useEffect(() => {
    const t = setInterval(() => setPulseOn(p => !p), 1200);
    return () => clearInterval(t);
  }, []);

  // Home activity feed — live from /api/actions
  useEffect(() => {
    if (activeNav !== "home") return;
    fetch("/api/actions?limit=8")
      .then(r => r.json())
      .then(d => setActivityFeed(d.events ?? []))
      .catch(() => {});
  }, [activeNav]);

  const proj = PROJECTS.find(p => p.key === activeProject)!;

  function renderMainContent() {
    switch (activeNav) {
      case "repo":     return <RepoPanel />;
      case "tasks":    return <TasksPanel />;
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
            { label:"Token expiry",     value: stats.tokenExpiry,    color:"#c0392b" },
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

  return (
    <div style={{ display:"grid", gridTemplateColumns:"48px 200px 1fr", gridTemplateRows:"44px 1fr", height:"100vh", background:"#0a0a0a", fontFamily:"'JetBrains Mono','Fira Code',monospace", color:"#d4d4d4", overflow:"hidden" }}>

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
        <div style={{ borderTop:"1px solid #141414", padding:"10px 16px", display:"flex", alignItems:"center", gap:10, background:"#090909" }}>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask Rune anything…"
            style={{ flex:1, background:"#111", border:"1px solid #1e1e1e", borderRadius:6, padding:"7px 12px", fontSize:11, color:"#d4d4d4", outline:"none", fontFamily:"inherit" }} />
          <button style={{ width:30, height:30, borderRadius:6, background:"#c0392b", border:"none", color:"#fff", cursor:"pointer", fontSize:14 }}>↑</button>
        </div>
      </div>
    </div>
  );
}
