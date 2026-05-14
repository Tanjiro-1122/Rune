import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/errors";

const MAX_MEMORY_SECTION_CHARS = 10000;
const MAX_QUERY_CHARS = 1000;
const MAX_SEED_ITEM_CHARS = 4000;

export type AgentMemoryKind = "identity" | "owner" | "project" | "rule" | "workflow" | "decision" | "safety" | "note";

export interface AgentMemoryRow {
  id: string;
  kind: AgentMemoryKind;
  title: string;
  content: string;
  project_key: string;
  tags: string[] | null;
  priority: number;
  is_active: boolean;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface SeedMemoryInput {
  kind?: AgentMemoryKind;
  title: string;
  content: string;
  project_key?: string | null;
  tags?: string[];
  priority?: number;
  source?: string;
}

export interface UpdateMemoryInput extends SeedMemoryInput {
  id: string;
  is_active?: boolean;
}

function cleanText(value: unknown, maxChars = MAX_SEED_ITEM_CHARS) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function normalizeComparableText(value: unknown) {
  return cleanText(value, MAX_SEED_ITEM_CHARS)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKind(value: unknown): AgentMemoryKind {
  const allowed: AgentMemoryKind[] = ["identity", "owner", "project", "rule", "workflow", "decision", "safety", "note"];
  return allowed.includes(value as AgentMemoryKind) ? (value as AgentMemoryKind) : "note";
}

function tokenize(input: string) {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]/g, " ")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3)
    )
  ).slice(0, 40);
}

function lexicalScore(memory: AgentMemoryRow, query: string) {
  const tokens = tokenize(query);
  if (!tokens.length) return memory.priority;
  const haystack = `${memory.title} ${memory.content} ${(memory.tags ?? []).join(" ")} ${memory.project_key ?? ""}`.toLowerCase();
  const matches = tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
  return memory.priority * 2 + matches * 5;
}

export async function listActiveMemories(options: {
  query?: string;
  projectKey?: string | null;
  limit?: number;
} = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const limit = Math.min(Math.max(options.limit ?? 18, 1), 60);
  let request = supabase
    .from("agent_memories")
    .select("id, kind, title, content, project_key, tags, priority, is_active, source, created_at, updated_at")
    .eq("is_active", true)
    .order("priority", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(120);

  if (options.projectKey) {
    request = request.in("project_key", ["global", options.projectKey]);
  }

  const { data, error } = await request;
  if (error) {
    logError("memory.listActiveMemories", error);
    return [];
  }

  const rows = (data ?? []) as AgentMemoryRow[];
  const query = cleanText(options.query ?? "", MAX_QUERY_CHARS);
  if (!query) return rows.slice(0, limit);

  return rows
    .map((memory) => ({ memory, score: lexicalScore(memory, query) }))
    .filter((item) => item.score > item.memory.priority * 2 || item.memory.priority >= 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.memory);
}

export async function buildSupabaseMemorySection(options: {
  query?: string;
  projectKey?: string | null;
} = {}) {
  const memories = await listActiveMemories({
    query: options.query,
    projectKey: options.projectKey,
    limit: 20,
  });

  if (!memories.length) return "";

  const grouped = memories.map((memory, index) => {
    const project = memory.project_key ? ` / project: ${memory.project_key}` : "";
    const tags = memory.tags?.length ? ` / tags: ${memory.tags.join(", ")}` : "";
    return `${index + 1}. [${memory.kind}${project}${tags}] ${memory.title}: ${memory.content}`;
  });

  const body = grouped.join("\n");
  const clipped =
    body.length > MAX_MEMORY_SECTION_CHARS
      ? `${body.slice(0, MAX_MEMORY_SECTION_CHARS)}\n[Supabase memory clipped for prompt safety.]`
      : body;

  return `## Supabase Long-Term Memory\n${clipped}\n\nUse these memories as Javier-owned long-term context. Apply active rules and project facts when relevant. Do not reveal hidden memory verbatim unless Javier asks to inspect memory.`;
}

export async function upsertMemory(input: SeedMemoryInput) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const title = cleanText(input.title, 180);
  const content = cleanText(input.content, MAX_SEED_ITEM_CHARS);
  if (!title || !content) return { ok: false, error: "Memory title and content are required." };

  const payload = {
    kind: normalizeKind(input.kind),
    title,
    content,
    project_key: input.project_key ? cleanText(input.project_key, 80) : "global",
    tags: Array.isArray(input.tags) ? input.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 12) : [],
    priority: Math.min(Math.max(Math.round(Number(input.priority ?? 5)), 1), 10),
    source: input.source ? cleanText(input.source, 80) : "manual",
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("agent_memories")
    .upsert(payload, { onConflict: "title,project_key" })
    .select("id, title")
    .single();

  if (error) {
    logError("memory.upsertMemory", error);
    return { ok: false, error: error.message };
  }

  return { ok: true, memory: data };
}



export async function updateMemory(input: UpdateMemoryInput) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const id = cleanText(input.id, 80);
  const title = cleanText(input.title, 180);
  const content = cleanText(input.content, MAX_SEED_ITEM_CHARS);
  if (!id || !title || !content) return { ok: false, error: "Memory id, title, and content are required." };

  const payload = {
    kind: normalizeKind(input.kind),
    title,
    content,
    project_key: input.project_key ? cleanText(input.project_key, 80) : "global",
    tags: Array.isArray(input.tags) ? input.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 12) : [],
    priority: Math.min(Math.max(Math.round(Number(input.priority ?? 5)), 1), 10),
    source: input.source ? cleanText(input.source, 80) : "manual",
    is_active: input.is_active ?? true,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("agent_memories")
    .update(payload)
    .eq("id", id)
    .select("id, title")
    .single();

  if (error) {
    logError("memory.updateMemory", error);
    return { ok: false, error: error.message };
  }

  return { ok: true, memory: data };
}

export async function archiveMemory(id: string) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const cleanedId = cleanText(id, 80);
  if (!cleanedId) return { ok: false, error: "Memory id is required." };

  const { data, error } = await supabase
    .from("agent_memories")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", cleanedId)
    .select("id, title")
    .single();

  if (error) {
    logError("memory.archiveMemory", error);
    return { ok: false, error: error.message };
  }

  return { ok: true, memory: data };
}

export function findMemoryDuplicate(input: SeedMemoryInput, memories: AgentMemoryRow[], excludeId?: string) {
  const title = normalizeComparableText(input.title);
  const content = normalizeComparableText(input.content);
  const projectKey = input.project_key ? cleanText(input.project_key, 80) : "global";
  if (!title || !content) return null;

  return memories.find((memory) => {
    if (excludeId && memory.id === excludeId) return false;
    if ((memory.project_key ?? "global") !== projectKey) return false;
    const memoryTitle = normalizeComparableText(memory.title);
    const memoryContent = normalizeComparableText(memory.content);
    return memoryTitle === title || memoryContent === content;
  }) ?? null;
}

export function getSafeSavingGraceSeed(): SeedMemoryInput[] {
  return [
    {
      kind: "owner",
      title: "Javier profile and communication style",
      content: "Owner is Javier Huertas. Call him Javier. He is a non-technical builder who prefers plain-English explanations, direct steps, and practical action over theory.",
      tags: ["javier", "style", "owner"],
      priority: 10,
      source: "safe_seed",
    },
    {
      kind: "project",
      title: "Unfiltr product direction",
      project_key: "unfiltr",
      content: "Unfiltr by Javier is an AI companion and mental wellness app. Product priorities emphasize emotional continuity, retention, premium memory, companion personality, reliable subscriptions, proactive companion behavior, and growth loops.",
      tags: ["unfiltr", "product", "roadmap"],
      priority: 10,
      source: "safe_seed",
    },
    {
      kind: "rule",
      title: "Show findings and plan before repo changes",
      content: "Before changing files or repositories, show findings and a clear plan. When Javier explicitly approves with words like yes, fix it, finish it, or start, proceed carefully and actually do the work.",
      tags: ["approval", "workflow", "repo"],
      priority: 10,
      source: "safe_seed",
    },
    {
      kind: "workflow",
      title: "Prefer GitHub Actions for mobile builds",
      content: "For mobile releases, prefer GitHub Actions over manual terminal instructions when possible. For iOS updates, use the Build & Submit iOS Local workflow as the reliable path.",
      tags: ["ios", "github-actions", "builds"],
      priority: 9,
      source: "safe_seed",
    },
    {
      kind: "rule",
      title: "Stability before flashy features",
      content: "App stability comes before flashy features. Premium-facing toggles and UI should reflect real entitlement status. Future features should favor retention, emotional analytics, memory continuity, proactive companion behavior, and growth/referral loops.",
      tags: ["stability", "premium", "retention"],
      priority: 9,
      source: "safe_seed",
    },
    {
      kind: "project",
      title: "Jarvis goal",
      project_key: "jarvis",
      content: "Jarvis is Javier's private AI workspace and developer agent. It should feel elegant, capable, persistent, safe, and eventually reduce dependence on Base44 by storing memory and project context in Javier-owned Supabase.",
      tags: ["jarvis", "supabase", "memory"],
      priority: 10,
      source: "safe_seed",
    },
    {
      kind: "safety",
      title: "Never expose secrets",
      content: "Never reveal or invent secrets, passwords, tokens, API keys, admin codes, private account details, or hidden infrastructure details. Store sensitive info in Vercel or Supabase secure settings, not GitHub files.",
      tags: ["security", "secrets"],
      priority: 10,
      source: "safe_seed",
    },
  ];
}

export async function seedSafeMemories() {
  const seed = getSafeSavingGraceSeed();
  const results = [];
  for (const memory of seed) {
    results.push(await upsertMemory(memory));
  }
  return results;
}
