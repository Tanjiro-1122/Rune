/**
 * lib/cross-app-intelligence.ts
 *
 * Rune Cross-App Intelligence Engine.
 * Reads live data from Base44 (Unfiltr + SWH) and Supabase (Rune memory)
 * to surface patterns Javier would never notice manually.
 *
 * Read-only. No writes to any app data.
 * Refreshed on demand or cached in agent_memories for daily briefing inclusion.
 */

import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/errors";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AppInsightMetric {
  label: string;
  value: string | number | null;
  trend?: string;       // e.g. "↑ +12% vs last week"
  status: "good" | "warn" | "neutral";
  detail?: string;
}

export interface AppInsightSection {
  app: "unfiltr" | "swh" | "rune";
  title: string;
  metrics: AppInsightMetric[];
  topInsight: string;   // one-line headline the briefing can surface
}

export interface CrossAppIntelligenceReport {
  ok: boolean;
  generatedAt: string;
  sections: AppInsightSection[];
  crossAppInsight: string;   // pattern that spans both apps
  weeklyHighlight: string;   // most interesting single fact this week
  error?: string;
}

// ── Base44 API client ──────────────────────────────────────────────────────

const BASE44_API_URL = "https://api.base44.com/v1";

function getBase44Key(): string {
  return (
    process.env.BASE44_API_KEY?.trim() ||
    process.env.RUNE_BASE44_API_KEY?.trim() ||
    ""
  );
}

async function base44List(
  appId: string,
  entityName: string,
  params: Record<string, string | number> = {}
): Promise<unknown[]> {
  const key = getBase44Key();
  if (!key) return [];

  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 500));
  if (params.skip) query.set("skip", String(params.skip));
  if (params.sort) query.set("sort", String(params.sort));

  // Add filter params
  Object.entries(params).forEach(([k, v]) => {
    if (!["limit", "skip", "sort"].includes(k)) {
      query.set(k, String(v));
    }
  });

  try {
    const res = await fetch(
      `${BASE44_API_URL}/apps/${appId}/entities/${entityName}?${query.toString()}`,
      {
        headers: {
          "x-api-key": key,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data?.items ?? data?.records ?? []);
  } catch {
    return [];
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

const UNFILTR_APP_ID = process.env.UNFILTR_APP_ID ?? "69b332a392004d139d4ba495";
const SWH_APP_ID = process.env.SWH_APP_ID ?? "";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function uniqueBy<T>(arr: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function countBy<T>(arr: T[], key: (item: T) => string): Record<string, number> {
  return arr.reduce((acc: Record<string, number>, item) => {
    const k = key(item);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}

function topN(obj: Record<string, number>, n: number): Array<[string, number]> {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ── Unfiltr Intelligence ───────────────────────────────────────────────────

async function analyzeUnfiltr(): Promise<AppInsightSection> {
  const metrics: AppInsightMetric[] = [];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const day7 = daysAgo(7);
  const day30 = daysAgo(30);

  // Fetch data in parallel
  const [chats, purchases, moods, journals, errors] = await Promise.all([
    base44List(UNFILTR_APP_ID, "ChatHistory", { limit: 500, sort: "-saved_at" }),
    base44List(UNFILTR_APP_ID, "PurchaseAudit", { limit: 500, sort: "-created_date" }),
    base44List(UNFILTR_APP_ID, "MoodEntry", { limit: 500, sort: "-created_date" }),
    base44List(UNFILTR_APP_ID, "JournalEntry", { limit: 500, sort: "-created_date" }),
    base44List(UNFILTR_APP_ID, "ErrorLog", { limit: 200, sort: "-created_date" }),
  ]);

  type ChatRow = { apple_user_id?: string; saved_at?: string; tier?: string; message_count?: number };
  type PurchaseRow = { apple_user_id?: string; product_id?: string; amount?: number; status?: string; created_date?: string; subscription_type?: string };
  type MoodRow = { mood_label?: string; date?: string; apple_user_id?: string };
  type JournalRow = { apple_user_id?: string; created_date?: string };
  type ErrorRow = { page?: string; severity?: string; resolved?: boolean };

  const chatRows = chats as ChatRow[];
  const purchaseRows = purchases as PurchaseRow[];
  const moodRows = moods as MoodRow[];
  const journalRows = journals as JournalRow[];
  const errorRows = errors as ErrorRow[];

  // ── DAU / MAU ──────────────────────────────────────────────────────────
  const todayChats = chatRows.filter((c) => (c.saved_at ?? "").slice(0, 10) === today);
  const dau = uniqueBy(todayChats, (c) => c.apple_user_id ?? "").length;
  const mauChats = chatRows.filter((c) => (c.saved_at ?? "").slice(0, 10) >= day30);
  const mau = uniqueBy(mauChats, (c) => c.apple_user_id ?? "").length;
  const wauChats = chatRows.filter((c) => (c.saved_at ?? "").slice(0, 10) >= day7);
  const wau = uniqueBy(wauChats, (c) => c.apple_user_id ?? "").length;
  metrics.push({ label: "DAU / WAU / MAU", value: `${dau} / ${wau} / ${mau}`, status: mau > 0 ? "good" : "warn" });

  // ── Free vs Pro ───────────────────────────────────────────────────────
  const tierCounts = countBy(chatRows, (c) => c.tier ?? "free");
  const proCount = (tierCounts["pro"] ?? 0) + (tierCounts["premium"] ?? 0) + (tierCounts["annual"] ?? 0);
  const freeCount = tierCounts["free"] ?? 0;
  const total = chatRows.length;
  const convRate = total > 0 ? ((proCount / total) * 100).toFixed(1) : "0";
  metrics.push({ label: "Free → Pro conversion", value: `${convRate}%`, detail: `${proCount} pro / ${freeCount} free sessions`, status: parseFloat(convRate) > 5 ? "good" : "warn" });

  // ── Revenue last 30d ─────────────────────────────────────────────────
  const recentPurchases = purchaseRows.filter(
    (p) => p.status === "success" && (p.created_date ?? "").slice(0, 10) >= day30
  );
  const revenue30d = recentPurchases.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  metrics.push({ label: "Revenue (last 30d)", value: `$${revenue30d.toFixed(2)}`, status: revenue30d > 0 ? "good" : "warn" });

  // ── Retention signal ─────────────────────────────────────────────────
  const userLastSeen: Record<string, string> = {};
  const userFirstSeen: Record<string, string> = {};
  for (const c of chatRows) {
    const uid = c.apple_user_id ?? "";
    const date = (c.saved_at ?? "").slice(0, 10);
    if (!userFirstSeen[uid] || date < userFirstSeen[uid]) userFirstSeen[uid] = date;
    if (!userLastSeen[uid] || date > userLastSeen[uid]) userLastSeen[uid] = date;
  }
  const allUsers = Object.keys(userLastSeen);
  const stillActive7d = allUsers.filter((u) => (userLastSeen[u] ?? "") >= day7).length;
  const retentionPct = allUsers.length > 0 ? ((stillActive7d / allUsers.length) * 100).toFixed(0) : "0";
  metrics.push({ label: "7-day retention", value: `${retentionPct}%`, status: parseInt(retentionPct) > 40 ? "good" : "warn" });

  // ── Mood distribution ────────────────────────────────────────────────
  const recentMoods = moodRows.filter((m) => (m.date ?? "").slice(0, 10) >= day30);
  const moodCounts = countBy(recentMoods, (m) => m.mood_label ?? "unknown");
  const topMoods = topN(moodCounts, 3).map(([label, count]) => `${label} (${count})`).join(", ");
  metrics.push({ label: "Top moods (30d)", value: topMoods || "no data", status: "neutral" });

  // ── Journal engagement ────────────────────────────────────────────────
  const recentJournals = journalRows.filter((j) => (j.created_date ?? "").slice(0, 10) >= day30);
  const journalAuthors = uniqueBy(recentJournals, (j) => j.apple_user_id ?? "").length;
  const journalPerUser = journalAuthors > 0 ? (recentJournals.length / journalAuthors).toFixed(1) : "0";
  metrics.push({ label: "Journal entries/user (30d)", value: journalPerUser, status: parseFloat(journalPerUser) > 2 ? "good" : "neutral" });

  // ── Error hotspots ────────────────────────────────────────────────────
  const unresolvedErrors = errorRows.filter((e) => !e.resolved);
  const errorsByPage = countBy(unresolvedErrors, (e) => e.page ?? "unknown");
  const topErrorPage = topN(errorsByPage, 1)[0];
  if (topErrorPage) {
    metrics.push({ label: "Top error page", value: `${topErrorPage[0]} (${topErrorPage[1]} errors)`, status: "warn" });
  }

  // ── Top insight ───────────────────────────────────────────────────────
  let topInsight = `${mau} monthly active users`;
  if (parseFloat(retentionPct) < 30) topInsight = `⚠️ Retention at ${retentionPct}% — users not coming back after first week`;
  else if (revenue30d > 0) topInsight = `$${revenue30d.toFixed(2)} revenue in last 30 days across ${recentPurchases.length} purchases`;
  else if (mau > 10) topInsight = `${mau} MAU with ${convRate}% free→pro conversion`;

  return { app: "unfiltr", title: "Unfiltr", metrics, topInsight };
}

// ── SWH Intelligence ───────────────────────────────────────────────────────

async function analyzeSWH(): Promise<AppInsightSection | null> {
  if (!SWH_APP_ID) return null;

  const metrics: AppInsightMetric[] = [];
  const day30 = daysAgo(30);

  const [bets, predictions] = await Promise.all([
    base44List(SWH_APP_ID, "TrackedBet", { limit: 500, sort: "-created_date" }),
    base44List(SWH_APP_ID, "PredictionOutcome", { limit: 500, sort: "-created_date" }),
  ]);

  type BetRow = { result?: string; stake?: number; payout?: number; sport?: string; confidence?: number; event_date?: string };
  type PredRow = { was_correct?: boolean; sport?: string; confidence?: number };

  const betRows = bets as BetRow[];
  const predRows = predictions as PredRow[];

  if (!betRows.length && !predRows.length) return null;

  // ── Win rate ──────────────────────────────────────────────────────────
  const settledBets = betRows.filter((b) => b.result === "win" || b.result === "loss");
  const wins = settledBets.filter((b) => b.result === "win").length;
  const winRate = settledBets.length > 0 ? ((wins / settledBets.length) * 100).toFixed(1) : "0";
  metrics.push({ label: "Bet win rate", value: `${winRate}%`, status: parseFloat(winRate) > 55 ? "good" : "warn" });

  // ── ROI ───────────────────────────────────────────────────────────────
  const totalStake = settledBets.reduce((s, b) => s + (b.stake ?? 0), 0);
  const totalPayout = settledBets.reduce((s, b) => s + (b.payout ?? 0), 0);
  const roi = totalStake > 0 ? (((totalPayout - totalStake) / totalStake) * 100).toFixed(1) : "0";
  metrics.push({ label: "Overall ROI", value: `${roi}%`, detail: `$${totalStake.toFixed(2)} staked`, status: parseFloat(roi) > 0 ? "good" : "warn" });

  // ── Win rate by sport ─────────────────────────────────────────────────
  const sportBets = countBy(settledBets.filter((b) => b.result === "win"), (b) => b.sport ?? "unknown");
  const sportTotals = countBy(settledBets, (b) => b.sport ?? "unknown");
  const sportRates = Object.entries(sportTotals)
    .map(([sport, total]) => ({ sport, rate: ((sportBets[sport] ?? 0) / total * 100).toFixed(0), total }))
    .sort((a, b) => parseFloat(b.rate) - parseFloat(a.rate));
  if (sportRates.length) {
    metrics.push({ label: "Best sport", value: `${sportRates[0].sport} (${sportRates[0].rate}% win rate)`, status: "good" });
  }

  // ── Prediction accuracy ───────────────────────────────────────────────
  if (predRows.length) {
    const correct = predRows.filter((p) => p.was_correct).length;
    const accRate = ((correct / predRows.length) * 100).toFixed(1);
    metrics.push({ label: "AI prediction accuracy", value: `${accRate}%`, status: parseFloat(accRate) > 60 ? "good" : "warn" });
  }

  const topInsight = settledBets.length > 0
    ? `${winRate}% win rate across ${settledBets.length} settled bets (ROI: ${roi}%)`
    : "No settled bets yet";

  return { app: "swh", title: "Sports Wager Helper", metrics, topInsight };
}

// ── Cross-app pattern detection ────────────────────────────────────────────

function buildCrossAppInsight(unfiltr: AppInsightSection, swh: AppInsightSection | null): string {
  const parts: string[] = [];

  const mauMetric = unfiltr.metrics.find((m) => m.label === "DAU / WAU / MAU");
  const retMetric = unfiltr.metrics.find((m) => m.label === "7-day retention");
  const convMetric = unfiltr.metrics.find((m) => m.label === "Free → Pro conversion");

  if (retMetric && convMetric) {
    const ret = parseFloat(String(retMetric.value));
    const conv = parseFloat(String(convMetric.value));
    if (ret < 30 && conv < 5) {
      parts.push("🔴 Retention + conversion both low — users aren't seeing value fast enough. Priority: improve D1 onboarding.");
    } else if (ret > 50 && conv < 5) {
      parts.push("🟡 Users are retained but not converting — consider a paywall nudge or feature gate.");
    } else if (conv > 10) {
      parts.push("🟢 Strong conversion rate — focus on driving more top-of-funnel installs.");
    }
  }

  if (swh) {
    const roiMetric = swh.metrics.find((m) => m.label === "Overall ROI");
    if (roiMetric && parseFloat(String(roiMetric.value)) > 10) {
      parts.push(`SWH bettors are up ${roiMetric.value} ROI — highlight this in app marketing.`);
    }
  }

  if (!parts.length) return "Gather more data to surface cross-app patterns.";
  return parts.join(" ");
}

// ── Cache in Supabase ──────────────────────────────────────────────────────

async function cacheReport(report: CrossAppIntelligenceReport): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.from("agent_memories").upsert(
      {
        kind: "note",
        title: "rune-cross-app-intelligence",
        content: JSON.stringify(report),
        project_key: "rune",
        tags: ["intelligence", "analytics", "cross-app"],
        priority: 4,
        is_active: true,
        source: "cross-app-intelligence",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "title,project_key" }
    );
  } catch {
    // non-fatal
  }
}

export async function getCachedReport(): Promise<CrossAppIntelligenceReport | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("agent_memories")
      .select("content, updated_at")
      .eq("title", "rune-cross-app-intelligence")
      .eq("project_key", "rune")
      .single();
    if (!data?.content) return null;
    const report: CrossAppIntelligenceReport = JSON.parse(data.content);
    // Use cache if less than 6 hours old
    const age = Date.now() - new Date(data.updated_at).getTime();
    if (age < 6 * 60 * 60 * 1000) return report;
    return null;
  } catch {
    return null;
  }
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Run full cross-app intelligence analysis.
 * Returns cached result if less than 6 hours old.
 * Pass force=true to bypass cache.
 */
export async function getCrossAppIntelligence(force = false): Promise<CrossAppIntelligenceReport> {
  if (!force) {
    const cached = await getCachedReport();
    if (cached) return cached;
  }

  try {
    const [unfiltr, swh] = await Promise.all([analyzeUnfiltr(), analyzeSWH()]);
    const sections: AppInsightSection[] = [unfiltr];
    if (swh) sections.push(swh);

    const crossAppInsight = buildCrossAppInsight(unfiltr, swh);

    // Weekly highlight — most interesting metric
    const allMetrics = sections.flatMap((s) => s.metrics);
    const warnMetrics = allMetrics.filter((m) => m.status === "warn");
    const goodMetrics = allMetrics.filter((m) => m.status === "good");
    const weeklyHighlight =
      warnMetrics[0]
        ? `⚠️ Watch: ${warnMetrics[0].label} — ${warnMetrics[0].value}`
        : goodMetrics[0]
        ? `✅ Win: ${goodMetrics[0].label} — ${goodMetrics[0].value}`
        : "No notable signals this week.";

    const report: CrossAppIntelligenceReport = {
      ok: true,
      generatedAt: new Date().toISOString(),
      sections,
      crossAppInsight,
      weeklyHighlight,
    };

    await cacheReport(report);
    return report;
  } catch (err) {
    logError("crossAppIntelligence", err);
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      sections: [],
      crossAppInsight: "Intelligence unavailable.",
      weeklyHighlight: "Intelligence unavailable.",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
