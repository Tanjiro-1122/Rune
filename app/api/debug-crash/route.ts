import { NextRequest } from "next/server";
import { getWorkspaceRetrievalContext } from "@/lib/workspaces";
import { buildSupabaseMemorySection, buildMemoryContext } from "@/lib/memory";
import { loadEnabledSkills } from "@/lib/skills";
import { getOwnerMemorySection } from "@/lib/owner-memory";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const results: Record<string, {ok: boolean; ms: number; error?: string}> = {};

  async function probe(key: string, fn: () => Promise<unknown>) {
    const start = Date.now();
    try {
      await fn();
      results[key] = { ok: true, ms: Date.now() - start };
    } catch (e) {
      results[key] = { ok: false, ms: Date.now() - start, error: String(e) };
    }
  }

  await probe("getWorkspaceRetrievalContext", () =>
    getWorkspaceRetrievalContext({ workspaceId: undefined, query: "test" })
  );
  await probe("buildSupabaseMemorySection", () =>
    buildSupabaseMemorySection({ query: "test", projectKey: "rune" })
  );
  await probe("buildMemoryContext", () =>
    buildMemoryContext("test", { semanticLimit: 3 })
  );
  await probe("loadEnabledSkills", () =>
    loadEnabledSkills()
  );
  await probe("getOwnerMemorySection", () =>
    Promise.resolve(getOwnerMemorySection())
  );

  return Response.json({ results }, { status: 200 });
}
