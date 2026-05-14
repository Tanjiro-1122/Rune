import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listActiveMemories, upsertMemory } from "@/lib/memory";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query") ?? undefined;
  const projectKey = req.nextUrl.searchParams.get("projectKey") ?? undefined;
  const memories = await listActiveMemories({ query, projectKey, limit: 50 });
  return NextResponse.json({ memories });
}

const MemorySchema = z.object({
  kind: z.enum(["identity", "owner", "project", "rule", "workflow", "decision", "safety", "note"]).optional(),
  title: z.string().min(1).max(180),
  content: z.string().min(1).max(4000),
  project_key: z.string().max(80).nullable().optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  source: z.string().max(80).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = MemorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid memory data.", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await upsertMemory(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Failed to save memory." }, { status: 500 });
  }

  return NextResponse.json(result, { status: 201 });
}
