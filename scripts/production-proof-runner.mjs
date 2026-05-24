#!/usr/bin/env node
import assert from "node:assert/strict";

const baseUrl = (process.env.RUNE_BASE_URL || process.env.JARVIS_BASE_URL || "https://mrruneai.vercel.app").replace(/\/$/, "");
const token = process.env.RUNE_INTERNAL_TOKEN || process.env.CRON_SECRET || "";

if (!token) {
  console.log(JSON.stringify({
    ok: false,
    blocked: true,
    blocker: "Missing RUNE_INTERNAL_TOKEN or CRON_SECRET in the environment running this proof.",
    nextManualStep: "Add the same internal token used by Rune production, then rerun `npm run proof:production`.",
  }, null, 2));
  process.exit(2);
}

async function check(path) {
  const started = Date.now();
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return {
    path,
    ok: res.ok,
    status: res.status,
    ms: Date.now() - started,
    bodyKeys: json && typeof json === "object" ? Object.keys(json).slice(0, 20) : [],
    statusValue: json?.status ?? json?.overall ?? json?.ok ?? null,
    snippet: text.slice(0, 500),
  };
}

const checks = [
  await check("/api/self-test?suite=supabase"),
  await check("/api/deploy-health"),
];

const result = {
  ok: checks.every((item) => item.ok),
  baseUrl,
  checks,
  proofBoundary: "Read-only production endpoint verification. Does not write memory, tasks, schemas, customers, payments, DNS, or entitlements.",
};

console.log(JSON.stringify(result, null, 2));
assert.equal(result.ok, true, "Production proof endpoints must return 2xx with internal auth");
