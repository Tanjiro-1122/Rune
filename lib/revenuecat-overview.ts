import { logError } from "@/lib/errors";

export interface RevenueCatOverviewResult {
  ok: boolean;
  configured: boolean;
  activeSubscribers: number | null;
  mrr: number | null;
  revenue30d: number | null;
  currency: string;
  error?: string;
}

function getRevenueCatApiKey() {
  return (
    process.env.REVENUECAT_API_KEY?.trim() ||
    process.env.REVENUECAT_SECRET_KEY?.trim() ||
    process.env.JARVIS_REVENUECAT_API_KEY?.trim() ||
    ""
  );
}

/**
 * Fetches aggregate revenue metrics from RevenueCat v2 Overview API.
 * Returns MRR, active subscriber count, and 30-day revenue.
 * Read-only — never modifies any subscriber data.
 */
export async function getRevenueCatOverview(): Promise<RevenueCatOverviewResult> {
  const apiKey = getRevenueCatApiKey();
  if (!apiKey) {
    return { ok: false, configured: false, activeSubscribers: null, mrr: null, revenue30d: null, currency: "USD", error: "RevenueCat API key not configured." };
  }

  try {
    // Step 1: get project list
    const projectsRes = await fetch("https://api.revenuecat.com/v2/projects", {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
    });

    if (!projectsRes.ok) {
      const text = await projectsRes.text().catch(() => "");
      // v2 not available — fall back gracefully
      return { ok: false, configured: true, activeSubscribers: null, mrr: null, revenue30d: null, currency: "USD", error: `RC v2 projects (${projectsRes.status}): ${text.slice(0, 120)}` };
    }

    const projectsData = await projectsRes.json();
    const projects: Array<{ id: string; name: string }> = projectsData?.items ?? [];
    if (!projects.length) {
      return { ok: true, configured: true, activeSubscribers: 0, mrr: 0, revenue30d: 0, currency: "USD" };
    }

    // Use first project (Unfiltr)
    const projectId = projects[0].id;

    // Step 2: get overview metrics
    const overviewRes = await fetch(
      `https://api.revenuecat.com/v2/projects/${projectId}/metrics/overview`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        cache: "no-store",
      }
    );

    if (!overviewRes.ok) {
      const text = await overviewRes.text().catch(() => "");
      return { ok: false, configured: true, activeSubscribers: null, mrr: null, revenue30d: null, currency: "USD", error: `RC overview (${overviewRes.status}): ${text.slice(0, 120)}` };
    }

    const overview = await overviewRes.json();
    const metrics = overview?.metrics ?? overview ?? {};

    // RevenueCat overview returns values like:
    // { mrr: { value: 12.34 }, active_subscriptions: { value: 5 }, revenue: { value: 45.00 } }
    function extractValue(obj: unknown): number | null {
      if (typeof obj === "number") return obj;
      if (obj && typeof obj === "object") {
        const o = obj as Record<string, unknown>;
        if (typeof o.value === "number") return o.value;
      }
      return null;
    }

    const mrr = extractValue(metrics.mrr ?? metrics.MRR);
    const activeSubscribers = extractValue(
      metrics.active_subscriptions ?? metrics.active_subscribers ?? metrics.activeSubscriptions
    );
    const revenue30d = extractValue(
      metrics.revenue ?? metrics.revenue_30d ?? metrics.revenueIn30Days
    );
    const currency: string =
      typeof metrics.currency === "string" ? metrics.currency.toUpperCase() : "USD";

    return { ok: true, configured: true, activeSubscribers, mrr, revenue30d, currency };
  } catch (err) {
    logError("revenuecat.overview", err);
    return {
      ok: false, configured: true, activeSubscribers: null, mrr: null, revenue30d: null, currency: "USD",
      error: err instanceof Error ? err.message : "RevenueCat overview fetch failed.",
    };
  }
}
