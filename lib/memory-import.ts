import { SeedMemoryInput, findMemoryDuplicate, listActiveMemories, upsertMemory } from "@/lib/memory";
import { logActionEvent } from "@/lib/action-events";

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "api key", pattern: /\b(api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\b/i },
  { name: "password", pattern: /\b(password|passcode|pwd)\b\s*[:=]/i },
  { name: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i },
  { name: "jwt", pattern: /\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}\b/ },
  { name: "stripe key", pattern: /\b(?:sk|rk)_(?:live|test)_[a-zA-Z0-9]{16,}\b/ },
  { name: "github token", pattern: /\bgh[pousr]_[a-zA-Z0-9_]{20,}\b/ },
];

const RAW_CHAT_PATTERNS = [
  /(^|\n)\s*(user|assistant|system|developer)\s*:/i,
  /<\/?(conversation|message|session|transcript)[^>]*>/i,
  /older messages truncated/i,
];

export type MemoryImportMode = "dry_run" | "import";

export interface MemoryImportInput {
  mode?: MemoryImportMode;
  approved?: boolean;
  source?: string;
  items: SeedMemoryInput[];
}

export interface MemoryImportItemResult {
  index: number;
  title: string;
  projectKey: string;
  action: "would_import" | "imported" | "duplicate" | "blocked" | "failed";
  reason?: string;
  memoryId?: string;
}

function combinedText(item: SeedMemoryInput) {
  return `${item.title ?? ""}\n${item.content ?? ""}\n${(item.tags ?? []).join(" ")}`;
}

function detectUnsafeContent(item: SeedMemoryInput): string | null {
  const text = combinedText(item);
  for (const check of SECRET_PATTERNS) {
    if (check.pattern.test(text)) return `Possible ${check.name} detected.`;
  }
  for (const pattern of RAW_CHAT_PATTERNS) {
    if (pattern.test(text)) return "Possible raw chat transcript detected. Import curated memories only.";
  }
  return null;
}

function normalizeSource(source: string | undefined) {
  const cleaned = String(source || "saving_grace_curated_import")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .slice(0, 80)
    .replace(/^_+|_+$/g, "");
  return cleaned || "saving_grace_curated_import";
}

export async function previewOrImportMemories(input: MemoryImportInput) {
  const mode: MemoryImportMode = input.mode === "import" ? "import" : "dry_run";
  const approved = Boolean(input.approved);
  const source = normalizeSource(input.source);
  const items = Array.isArray(input.items) ? input.items.slice(0, 100) : [];
  const results: MemoryImportItemResult[] = [];

  if (mode === "import" && !approved) {
    return {
      ok: false,
      mode,
      imported: 0,
      blocked: items.length,
      results: items.map((item, index) => ({
        index,
        title: item.title || `item_${index + 1}`,
        projectKey: item.project_key || "global",
        action: "blocked" as const,
        reason: "Import mode requires approved=true after Javier reviews the dry run.",
      })),
    };
  }

  for (const [index, item] of items.entries()) {
    const title = String(item.title || "").trim();
    const content = String(item.content || "").trim();
    const projectKey = item.project_key || "global";

    if (!title || !content) {
      results.push({ index, title: title || `item_${index + 1}`, projectKey, action: "blocked", reason: "Title and content are required." });
      continue;
    }

    const unsafeReason = detectUnsafeContent(item);
    if (unsafeReason) {
      results.push({ index, title, projectKey, action: "blocked", reason: unsafeReason });
      continue;
    }

    const existing = await listActiveMemories({ projectKey, limit: 120 });
    const duplicate = findMemoryDuplicate({ ...item, source }, existing);
    if (duplicate) {
      results.push({ index, title, projectKey, action: "duplicate", reason: `Similar active memory exists: ${duplicate.title}`, memoryId: duplicate.id });
      continue;
    }

    if (mode === "dry_run") {
      results.push({ index, title, projectKey, action: "would_import" });
      continue;
    }

    const saved = await upsertMemory({ ...item, source });
    if (!saved.ok) {
      results.push({ index, title, projectKey, action: "failed", reason: saved.error || "Failed to import memory." });
      continue;
    }

    results.push({ index, title, projectKey, action: "imported", memoryId: saved.memory?.id });
  }

  const imported = results.filter((result) => result.action === "imported").length;
  const blocked = results.filter((result) => result.action === "blocked" || result.action === "failed").length;
  const duplicates = results.filter((result) => result.action === "duplicate").length;

  await logActionEvent({
    eventType: mode === "import" ? "memory.imported_batch" : "memory.import_previewed",
    summary: mode === "import"
      ? `Curated memory import completed: ${imported} imported, ${blocked} blocked, ${duplicates} duplicates.`
      : `Curated memory import dry run completed: ${results.filter((result) => result.action === "would_import").length} ready, ${blocked} blocked, ${duplicates} duplicates.`,
    status: blocked > 0 ? "blocked" : mode === "import" ? "executed" : "proposed",
    approvalStage: mode === "import" ? "complete" : "approval",
    riskLevel: "medium",
    projectKey: "jarvis",
    metadata: { mode, source, imported, blocked, duplicates, total: items.length },
  });

  return {
    ok: blocked === 0,
    mode,
    source,
    total: items.length,
    imported,
    blocked,
    duplicates,
    ready: results.filter((result) => result.action === "would_import").length,
    results,
  };
}
