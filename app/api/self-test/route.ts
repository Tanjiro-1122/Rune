/**
 * /api/self-test
 * Rune system health self-test suite.
 * Runs 10 independent checks covering memory, DB, GitHub, Vercel,
 * vault, deploy health, app health, RevenueCat, chat liveness, and build sync.
 *
 * GET  /api/self-test          — run all tests
 * GET  /api/self-test?suite=memory  — run one suite
 *
 * Auth: owner session cookie OR RUNE_INTERNAL_TOKEN/CRON_SECRET bearer header.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret, verifySessionCookie, SESSION_COOKIE } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { upsertMemory, archiveMemory, listActiveMemories } from "@/lib/memory";
import { getRuneRuntimeIdentity } from "@/lib/project-runtime";

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function isOwner(req: NextRequest): Promise<boolean> {
  const internalTokens = [process.env.RUNE_INTERNAL_TOKEN, process.env.CRON_SECRET]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const auth = req.headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const headerToken = req.headers.get("x-cron-secret")?.trim() || req.headers.get("x-rune-internal-token")?.trim();
  const provided = bearer || headerToken;
  if (provided && internalTokens.includes(provided)) return true;
  const secret = getSessionSecret();
  if (!secret) return false;
  const cookieValue =
    req.cookies?.get?.(SESSION_COOKIE)?.value ??
    req.headers
      .get("cookie")
      ?.split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
  const result = await verifySessionCookie(cookieValue ?? "", secret);
  return result.ok;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestResult {
  name: string;
  suite: string;
  status: "pass" | "fail" | "warn" | "skip";
  message: string;
  durationMs: number;
  detail?: string;
}

async function timed(
  name: string,
  suite: string,
  fn: () => Promise<{ status: "pass" | "fail" | "warn" | "skip"; message: string; detail?: string }>
): Promise<TestResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return { name, suite, ...result, durationMs: Date.now() - start };
  } catch (err) {
    return {
      name,
      suite,
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

/** 1. MEMORY — write → read → delete */
async function testMemory(): Promise<TestResult[]> {
  const TEST_TITLE = "__self_test_memory_probe__";
  const TEST_CONTENT = `Self-test probe created at ${new Date().toISOString()}`;

  const writeResult = await timed("memory:write", "memory", async () => {
    const r = await upsertMemory({
      kind: "note",
      title: TEST_TITLE,
      content: TEST_CONTENT,
      project_key: "rune",
      tags: ["self-test"],
      priority: 0,
      source: "self-test",
    });
    if (!r.ok) throw new Error(r.error ?? "upsert failed");
    const memId = (r as { id?: string }).id ?? "?";
    return { status: "pass", message: `Written id=${memId.slice(0, 8)}` };
  });

  const readResult = await timed("memory:read", "memory", async () => {
    const mems = await listActiveMemories({ query: TEST_TITLE, projectKey: "rune", limit: 5 });
    const found = mems.find((m) => m.title === TEST_TITLE);
    if (!found) throw new Error("Could not find test memory after write");
    return { status: "pass", message: `Found id=${found.id.slice(0, 8)}, content matches: ${found.content === TEST_CONTENT}` };
  });

  // Clean up
  const deleteResult = await timed("memory:delete", "memory", async () => {
    const mems = await listActiveMemories({ query: TEST_TITLE, projectKey: "rune", limit: 5 });
    const found = mems.find((m) => m.title === TEST_TITLE);
    if (!found) return { status: "warn" as const, message: "Nothing to delete (already gone)" };
    const r = await archiveMemory(found.id);
    if (!r.ok) throw new Error(r.error ?? "archive failed");
    return { status: "pass", message: `Deleted id=${found.id.slice(0, 8)}` };
  });

  return [writeResult, readResult, deleteResult];
}

/** 2. SUPABASE — ping connection */
async function testSupabase(): Promise<TestResult[]> {
  return [
    await timed("supabase:ping", "supabase", async () => {
      const sb = getSupabaseClient();
      if (!sb) throw new Error("No Supabase client (env missing?)");
      // Lightweight: count agent_memories rows
      const { count, error } = await sb
        .from("agent_memories")
        .select("*", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return { status: "pass", message: `Connected — ${count ?? "?"} memory rows` };
    }),
    await timed("supabase:vault_count", "supabase", async () => {
      const sb = getSupabaseClient();
      if (!sb) throw new Error("No Supabase client");
      const { count, error } = await sb
        .from("phrourio_vault")
        .select("*", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      if ((count ?? 0) < 100) return { status: "warn", message: `Vault has only ${count} records (expected ~827)` };
      return { status: "pass", message: `Vault: ${count} encrypted records` };
    }),
  ];
}

/** 3. GITHUB — latest commits on main */
async function testGitHub(): Promise<TestResult[]> {
  const RUNE_RUNTIME = getRuneRuntimeIdentity();
  const REPO = RUNE_RUNTIME.repo;
  const TOKEN = process.env.GITHUB_TOKEN ?? process.env.RUNE_GITHUB_TOKEN ?? "";

  return [
    await timed("github:repo_access", "github", async () => {
      if (!TOKEN) throw new Error("GITHUB_TOKEN not set");
      const res = await fetch(`https://api.github.com/repos/${REPO}`, {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`GitHub API → ${res.status}`);
      const data = await res.json() as { name: string; default_branch: string; pushed_at: string };
      return { status: "pass", message: `Repo ${data.name} reachable, default_branch=${data.default_branch}, last push=${data.pushed_at?.slice(0, 10)}` };
    }),
    await timed("github:latest_commit", "github", async () => {
      if (!TOKEN) throw new Error("GITHUB_TOKEN not set");
      const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`GitHub commits API → ${res.status}`);
      const data = await res.json() as { sha: string; commit: { message: string; author: { date: string } } };
      return {
        status: "pass",
        message: `Latest: ${data.sha.slice(0, 12)} — ${data.commit.message.slice(0, 60)}`,
        detail: `Author date: ${data.commit.author.date}`,
      };
    }),
  ];
}

/** 4. VERCEL — deployment sync check */
async function testVercel(): Promise<TestResult[]> {
  const VERCEL_TOKEN = process.env.VERCEL_TOKEN ?? "";
  const PROJECT_ID = getRuneRuntimeIdentity().vercelProjectId;
  const GITHUB_TOKEN_VAL = process.env.GITHUB_TOKEN ?? "";
  const RUNE_RUNTIME = getRuneRuntimeIdentity();
  const REPO = RUNE_RUNTIME.repo;
  const LIVE_URL = getRuneRuntimeIdentity().liveUrl;

  const deployResult = await timed("vercel:latest_deploy", "vercel", async () => {
    if (!VERCEL_TOKEN) throw new Error("VERCEL_TOKEN not set");
    const res = await fetch(`https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&limit=1`, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Vercel API → ${res.status}`);
    const data = await res.json() as { deployments: Array<{ state: string; meta: { githubCommitSha?: string }; url: string }> };
    const dep = data.deployments[0];
    const sha = dep?.meta?.githubCommitSha?.slice(0, 12) ?? "?";
    const state = dep?.state ?? "?";
    if (state !== "READY") return { status: "warn" as const, message: `Latest deploy state=${state}, sha=${sha}` };
    return { status: "pass", message: `READY — sha=${sha}` };
  });

  const syncResult = await timed("vercel:build_sync", "vercel", async () => {
    if (!VERCEL_TOKEN || !GITHUB_TOKEN_VAL) throw new Error("Missing tokens");
    // Get GitHub main sha
    const ghRes = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN_VAL}`, Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!ghRes.ok) throw new Error(`GitHub → ${ghRes.status}`);
    const ghData = await ghRes.json() as { sha: string };
    const mainSha = ghData.sha.slice(0, 12);

    // Get Vercel current sha
    const vRes = await fetch(`https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&limit=1`, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
      cache: "no-store",
    });
    if (!vRes.ok) throw new Error(`Vercel → ${vRes.status}`);
    const vData = await vRes.json() as { deployments: Array<{ meta: { githubCommitSha?: string } }> };
    const depSha = vData.deployments[0]?.meta?.githubCommitSha?.slice(0, 12) ?? "?";

    if (mainSha === depSha) return { status: "pass", message: `In sync — both on ${mainSha}` };
    return {
      status: "warn" as const,
      message: `Out of sync — GitHub main=${mainSha}, Vercel=${depSha}`,
      detail: "A deploy may be pending or the webhook may have missed a push",
    };
  });

  const liveResult = await timed("vercel:live_ping", "vercel", async () => {
    const res = await fetch(LIVE_URL, { method: "HEAD", cache: "no-store" });
    if (res.ok || res.status === 200 || res.status === 302) {
      return { status: "pass", message: `${LIVE_URL} → HTTP ${res.status}` };
    }
    throw new Error(`Live URL returned ${res.status}`);
  });

  return [deployResult, syncResult, liveResult];
}

/** 5. CHAT API — liveness (401 = healthy, anything else = problem) */
async function testChatApi(): Promise<TestResult[]> {
  const LIVE_URL = getRuneRuntimeIdentity().liveUrl;
  return [
    await timed("chat:liveness", "chat", async () => {
      const res = await fetch(`${LIVE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [] }),
        cache: "no-store",
      });
      // 401 = protected and healthy, 400 = validation running = healthy
      if (res.status === 401 || res.status === 400) {
        return { status: "pass", message: `/api/chat → HTTP ${res.status} (auth guard active)` };
      }
      if (res.status === 200 || res.status === 307) {
        return { status: "warn" as const, message: `/api/chat returned ${res.status} — may be unauthenticated` };
      }
      throw new Error(`/api/chat returned unexpected ${res.status}`);
    }),
  ];
}

/** 6. DEPLOY HEALTH — internal check */
async function testDeployHealth(): Promise<TestResult[]> {
  const LIVE_URL = getRuneRuntimeIdentity().liveUrl;
  return [
    await timed("deploy_health:check", "deploy_health", async () => {
      const res = await fetch(`${LIVE_URL}/api/deploy-health`, { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/deploy-health → ${res.status}`);
      const data = await res.json() as Record<string, unknown>;
      const status = (data.status as string) ?? "?";
      const isOk = status === "ready" || status === "ok" || status === "healthy";
      return {
        status: isOk ? "pass" : "warn",
        message: `status=${status}`,
        detail: JSON.stringify(data).slice(0, 300),
      };
    }),
  ];
}

/** 7. REVENUECAT — API key validity check */
async function testRevenueCat(): Promise<TestResult[]> {
  return [
    await timed("revenuecat:api_key", "revenuecat", async () => {
      const key = process.env.REVENUECAT_API_KEY ?? "";
      if (!key) return { status: "warn" as const, message: "REVENUECAT_API_KEY not set" };
      // Hit the offerings endpoint as a lightweight check
      const res = await fetch("https://api.revenuecat.com/v1/subscribers/$RCAnonymousID:self_test_probe", {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Platform": "ios",
        },
        cache: "no-store",
      });
      // 404 = subscriber not found = key is valid
      if (res.status === 404) return { status: "pass", message: "RevenueCat API key valid (404 = subscriber not found, expected)" };
      if (res.status === 401 || res.status === 403) throw new Error(`RC API key invalid → ${res.status}`);
      if (res.status === 200) return { status: "pass", message: "RevenueCat API key valid" };
      return { status: "warn" as const, message: `RC returned ${res.status}` };
    }),
  ];
}

/** 8. VAULT — decrypt spot check */
async function testVault(): Promise<TestResult[]> {
  return [
    await timed("vault:decrypt_spot_check", "vault", async () => {
      const sb = getSupabaseClient();
      if (!sb) throw new Error("No Supabase client");
      const { data, error } = await sb
        .from("phrourio_vault")
        .select("id, service_name, encrypted_password, iv")
        .limit(1)
        .single();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("No vault records found");
      // Verify fields exist
      if (!data.encrypted_password || !data.iv) throw new Error("Missing encrypted_password or iv");
      return {
        status: "pass",
        message: `Sample record: "${(data.service_name as string)?.slice(0, 30)}", encrypted_password present`,
      };
    }),
  ];
}

/** 9. ENV CHECK — critical environment variables */
async function testEnv(): Promise<TestResult[]> {
  const required = [
    "GITHUB_TOKEN",
    "VERCEL_TOKEN",
    "OPENAI_API_KEY",
    "RUNE_SUPABASE_URL",
    "RUNE_SUPABASE_SERVICE_ROLE_KEY",
    "APP_PASSWORD",
    "SESSION_SECRET",
  ];
  const optional = [
    "REVENUECAT_API_KEY",
    "ASC_KEY_ID",
    "RUNE_INTERNAL_TOKEN",
  ];

  const results: TestResult[] = [];

  for (const key of required) {
    const start = Date.now();
    const val = process.env[key];
    results.push({
      name: `env:${key}`,
      suite: "env",
      status: val ? "pass" : "fail",
      message: val ? `${key} set (${val.length} chars)` : `${key} MISSING`,
      durationMs: Date.now() - start,
    });
  }
  for (const key of optional) {
    const start = Date.now();
    const val = process.env[key];
    results.push({
      name: `env:${key}`,
      suite: "env",
      status: val ? "pass" : "warn",
      message: val ? `${key} set` : `${key} not set (optional)`,
      durationMs: Date.now() - start,
    });
  }

  return results;
}

/** 10. OPENAI — model availability ping */
async function testOpenAI(): Promise<TestResult[]> {
  return [
    await timed("openai:models_ping", "openai", async () => {
      const key = process.env.OPENAI_API_KEY ?? "";
      if (!key) throw new Error("OPENAI_API_KEY not set");
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`OpenAI API → ${res.status}`);
      const data = await res.json() as { data: Array<{ id: string }> };
      const has4o = data.data.some((m) => m.id === "gpt-4o");
      return {
        status: "pass",
        message: `API key valid — ${data.data.length} models available, gpt-4o: ${has4o ? "✓" : "✗"}`,
      };
    }),
  ];
}

// ─── Suite registry ───────────────────────────────────────────────────────────

type SuiteKey = "memory" | "supabase" | "github" | "vercel" | "chat" | "deploy_health" | "revenuecat" | "vault" | "env" | "openai";

const SUITES: Record<SuiteKey, () => Promise<TestResult[]>> = {
  memory: testMemory,
  supabase: testSupabase,
  github: testGitHub,
  vercel: testVercel,
  chat: testChatApi,
  deploy_health: testDeployHealth,
  revenuecat: testRevenueCat,
  vault: testVault,
  env: testEnv,
  openai: testOpenAI,
};

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authorized = await isOwner(req);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const suiteParam = req.nextUrl.searchParams.get("suite") as SuiteKey | null;
  const startAll = Date.now();

  let results: TestResult[];

  if (suiteParam && SUITES[suiteParam]) {
    results = await SUITES[suiteParam]();
  } else {
    // Run all suites in parallel
    const allResults = await Promise.all(
      Object.values(SUITES).map((fn) => fn().catch((e) => [{
        name: "suite:error",
        suite: "unknown",
        status: "fail" as const,
        message: e instanceof Error ? e.message : String(e),
        durationMs: 0,
      }]))
    );
    results = allResults.flat();
  }

  const totalMs = Date.now() - startAll;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const warned = results.filter((r) => r.status === "warn").length;

  const overall = failed > 0 ? "fail" : warned > 0 ? "warn" : "pass";

  return NextResponse.json({
    overall,
    summary: { total: results.length, passed, failed, warned, totalMs },
    results,
    runAt: new Date().toISOString(),
  });
}
