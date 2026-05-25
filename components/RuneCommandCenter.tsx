"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const PROJECTS = [
  { key: "rune",    label: "Rune",          repo: "Tanjiro-1122/Rune",                  tag: "OWNER-CONSOLE",       color: "#c0392b" },
  { key: "unfiltr", label: "Unfiltr",        repo: "Tanjiro-1122/unfiltrbyjavierbackup", tag: "SENSITIVE PRODUCTION", color: "#e67e22" },
  { key: "swh",     label: "SWH",            repo: "Tanjiro-1122/swhmobile",             tag: "PRODUCTION APP",       color: "#27ae60" },
  { key: "family",  label: "Unfiltr Family", repo: "Tanjiro-1122/UnfiltrFamily",         tag: "SENSITIVE PRODUCTION", color: "#8e44ad" },
];

const NAV = [
  { id: "home",     icon: "⌘", label: "Command center", route: "/"              },
  { id: "repo",     icon: "⎇", label: "Repo control",   route: "/repo-actions"  },
  { id: "tasks",    icon: "✓", label: "Tasks",           route: "/tasks"         },
  { id: "memory",   icon: "◈", label: "Memory",          route: "/memory"        },
  { id: "deploy",   icon: "↑", label: "Deploy",          route: "/deploy-health" },
  { id: "activity", icon: "≋", label: "Activity",        route: "/history"       },
];

type FeedItem = { type: "pr"|"deploy"|"task"|"error"|"info"; title: string; desc: string; time: string; };

const MOCK_FEED: FeedItem[] = [
  { type: "pr",     title: "PR #195 opened — Safe file create: test-write.md",  desc: "Tanjiro-1122/Rune · edge_function_octokit · executed",          time: "2m ago" },
  { type: "deploy", title: "Deployed a845334 to production",                     desc: "replace openRepoActionPullRequest with pure Octokit API",        time: "1h ago" },
  { type: "pr",     title: "PR #194 — Add source truth count guard",             desc: "Tanjiro-1122/Rune · opened by Saving Grace",                    time: "1h ago" },
  { type: "task",   title: "Task completed — create test-write.md",             desc: "100% · Capture → Execute → Persist",                            time: "5m ago" },
  { type: "error",  title: "GitHub token expiring in 2 days",                   desc: "Saving Grace token · update in Vercel + Supabase secrets",       time: "now"    },
];

const FEED_COLORS: Record<FeedItem["type"], {bg:string;color:string;symbol:string}> = {
  pr:     { bg: "#0d1f0d", color: "#4ade80", symbol: "⎇" },
  deploy: { bg: "#0d1520", color: "#60a5fa", symbol: "↑" },
  task:   { bg: "#1f1a08", color: "#f59e0b", symbol: "✓" },
  error:  { bg: "#200d0d", color: "#c0392b", symbol: "!" },
  info:   { bg: "#161616", color: "#888",    symbol: "i" },
};

export default function RuneCommandCenter() {
  const router = useRouter();
  const [activeNav, setActiveNav]         = useState("home");
  const [activeProject, setActiveProject] = useState("rune");
  const [input, setInput]                 = useState("");
  const [pulseOn, setPulseOn]             = useState(true);

  useEffect(() => {
    const t = setInterval(() => setPulseOn(p => !p), 1200);
    return () => clearInterval(t);
  }, []);

  const proj = PROJECTS.find(p => p.key === activeProject)!;

  function handleNav(n: typeof NAV[number]) {
    setActiveNav(n.id);
    router.push(n.route);
  }

  return (
    <div style={{ display:"grid", gridTemplateColumns:"48px 200px 1fr", gridTemplateRows:"44px 1fr", height:"100vh", background:"#0a0a0a", fontFamily:"'JetBrains Mono','Fira Code',monospace", color:"#d4d4d4", overflow:"hidden" }}>

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <div style={{ gridColumn:"1 / -1", background:"#080808", borderBottom:"1px solid #1a1a1a", display:"flex", alignItems:"center", padding:"0 16px", gap:12 }}>
        <div style={{ width:26, height:26, borderRadius:5, background:"#111", border:"1px solid #2a2a2a", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:"#c0392b", fontWeight:700 }}>R</div>
        <span style={{ fontSize:12, fontWeight:600, color:"#e8e8e8", letterSpacing:"0.05em" }}>RUNE</span>
        <span style={{ fontSize:10, color:"#333", marginLeft:2 }}>command center</span>

        {/* Project pills — clicking switches active project + updates header repo */}
        <div style={{ display:"flex", gap:6, marginLeft:"auto" }}>
          {PROJECTS.map(p => (
            <button
              key={p.key}
              onClick={() => setActiveProject(p.key)}
              style={{ fontSize:10, padding:"3px 10px", borderRadius:20, border: activeProject===p.key ? `1px solid ${p.color}` : "1px solid #222", background: activeProject===p.key ? p.color+"22" : "transparent", color: activeProject===p.key ? p.color : "#555", cursor:"pointer", fontFamily:"inherit" }}
            >{p.label}</button>
          ))}
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:6, marginLeft:16 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background: pulseOn ? "#27ae60" : "#1a6b35", transition:"background 0.4s" }} />
          <span style={{ fontSize:10, color:"#444" }}>all systems healthy</span>
        </div>
      </div>

      {/* ── Icon nav rail ──────────────────────────────────────────────────── */}
      <div style={{ gridRow:2, background:"#080808", borderRight:"1px solid #141414", display:"flex", flexDirection:"column", alignItems:"center", padding:"10px 0", gap:2 }}>
        {NAV.map((n, i) => (
          <div key={n.id}>
            {i === 4 && <div style={{ width:28, height:1, background:"#1e1e1e", margin:"4px 0" }} />}
            <button
              onClick={() => handleNav(n)}
              title={n.label}
              style={{ width:34, height:34, borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", border:"none", background: activeNav===n.id ? "#1e0a0a" : "transparent", color: activeNav===n.id ? "#c0392b" : "#3a3a3a", fontSize:16, fontFamily:"inherit" }}
            >{n.icon}</button>
          </div>
        ))}
        <button
          onClick={() => router.push("/vault")}
          style={{ marginTop:"auto", width:34, height:34, borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", border:"none", background:"transparent", color:"#2a2a2a", fontSize:16, fontFamily:"inherit" }}
        >⚙</button>
      </div>

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <div style={{ gridRow:2, background:"#0b0b0b", borderRight:"1px solid #141414", overflowY:"auto", padding:"14px 0" }}>
        {[
          {
            label: "Repo control",
            items: [
              { icon:"⎇", text:"Open PRs",        badge:"3",  bc:"#c0392b", onClick: () => router.push("/repo-actions")  },
              { icon:"○", text:"Pending approval", badge:"1",  bc:"#e67e22", onClick: () => router.push("/repo-actions")  },
              { icon:"✓", text:"Executed",          badge:"12", bc:"#333",    onClick: () => router.push("/history")       },
            ],
          },
          {
            label: "Projects",
            items: PROJECTS.map(p => ({
              icon: "◉", text: p.label, badge: "ok", bc: "#1e6b3a",
              onClick: () => setActiveProject(p.key),
            })),
          },
          {
            label: "Quick actions",
            items: [
              { icon:"+", text:"Create file", badge: null, bc:"", onClick: () => router.push("/app-forge")      },
              { icon:"✎", text:"Edit file",   badge: null, bc:"", onClick: () => router.push("/files/signed-url") },
              { icon:"↑", text:"Deploy",      badge: null, bc:"", onClick: () => router.push("/deploy-health")   },
            ],
          },
        ].map(section => (
          <div key={section.label} style={{ padding:"0 10px", marginBottom:20 }}>
            <div style={{ fontSize:9, color:"#333", letterSpacing:"0.1em", textTransform:"uppercase", padding:"0 6px", marginBottom:6 }}>{section.label}</div>
            {section.items.map(item => (
              <div
                key={item.text}
                onClick={item.onClick}
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

      {/* ── Main panel ─────────────────────────────────────────────────────── */}
      <div style={{ gridRow:2, display:"flex", flexDirection:"column", background:"#0e0e0e", overflow:"hidden" }}>
        <div style={{ padding:"12px 20px", borderBottom:"1px solid #141414", display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ color:"#c0392b", fontSize:15 }}>⌘</span>
          <span style={{ fontSize:13, fontWeight:600, color:"#e8e8e8" }}>Command center</span>
          {/* Header repo updates when project pill is clicked */}
          <span style={{ fontSize:10, color:"#333", marginLeft:"auto" }}>{proj.repo} · main</span>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, padding:"14px 20px", borderBottom:"1px solid #141414" }}>
          {[
            { label:"Open PRs",        value:"3",     color:"#e8e8e8" },
            { label:"Last deploy",     value:"✓ live", color:"#27ae60" },
            { label:"Pending approval",value:"1",     color:"#f59e0b" },
            { label:"Token expiry",    value:"2d",    color:"#c0392b" },
          ].map(s => (
            <div key={s.label} style={{ background:"#111", border:"1px solid #1e1e1e", borderRadius:7, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"#444", marginBottom:6, letterSpacing:"0.06em", textTransform:"uppercase" }}>{s.label}</div>
              <div style={{ fontSize:20, fontWeight:600, color:s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"14px 20px" }}>
          <div style={{ fontSize:9, color:"#333", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>Recent activity</div>
          {MOCK_FEED.map((item, i) => {
            const c = FEED_COLORS[item.type];
            return (
              <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"9px 0", borderBottom:"1px solid #141414" }}>
                <div style={{ width:28, height:28, borderRadius:6, flexShrink:0, background:c.bg, color:c.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, marginTop:1 }}>{c.symbol}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11, color:"#ccc", fontWeight:500 }}>{item.title}</div>
                  <div style={{ fontSize:10, color:"#444", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.desc}</div>
                </div>
                <div style={{ fontSize:9, color:"#333", flexShrink:0, paddingTop:2 }}>{item.time}</div>
              </div>
            );
          })}
        </div>

        <div style={{ borderTop:"1px solid #141414", padding:"10px 16px", display:"flex", alignItems:"center", gap:10, background:"#090909" }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask Rune anything..."
            style={{ flex:1, background:"#111", border:"1px solid #1e1e1e", borderRadius:6, padding:"7px 12px", fontSize:11, color:"#d4d4d4", outline:"none", fontFamily:"inherit" }}
          />
          <button style={{ width:30, height:30, borderRadius:6, background:"#c0392b", border:"none", color:"#fff", cursor:"pointer", fontSize:14 }}>↑</button>
        </div>
      </div>
    </div>
  );
}
