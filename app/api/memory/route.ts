import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  archiveMemory,
  findMemoryDuplicate,
  listActiveMemories,
  updateMemory,
  upsertMemory,
} from "@/lib/memory";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query") ?? undefined;
  const projectKey = req.nextUrl.searchParams.get("projectKey") ?? undefined;
  const memories = await listActiveMemories({ query, projectKey, limit: 50 });
  return NextResponse.json({ memories });
}

const KindSchema = z.enum(["identity", "owner", "project", "rule", "workflow", "decision", "safety", "note"]);

const MemorySchema = z.object({
  id: z.string().min(1).max(120).optional(),
  kind: KindSchema.optional(),
  title: z.string().min(1).max(180),
  content: z.string().min(1).max(4000),
  project_key: z.string().max(80).nullable().optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  source: z.string().max(80).optional(),
});

const ArchiveSchema = z.object({
  id: z.string().min(1).max(120),
  action: z.literal("archive"),
});

async function parseJson(req: NextRequest) {
  try {
    return { ok: true as const, body: await req.json() };
  } catch {
    return { ok: false as const, response: NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }) };
  }
}

export async function POST(req: NextRequest) {
  const parsedJson = await parseJson(req);
  if (!parsedJson.ok) return parsedJson.response;

  const parsed = MemorySchema.safeParse(parsedJson.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid memory data.", details: parsed.error.flatten() }, { status: 400 });
  }

  const projectKey = parsed.data.project_key ?? "global";
  const memories = await listActiveMemories({ projectKey, limit: 120 });
  const duplicate = findMemoryDuplicate(parsed.data, memories);
  if (duplicate) {
    return NextResponse.json({ error: "A similar active memory already exists.", duplicate }, { status: 409 });
  }

  const result = await upsertMemory(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Failed to save memory." }, { status: 500 });
  }

  return NextResponse.json(result, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const parsedJson = await parseJson(req);
  if (!parsedJson.ok) return parsedJson.response;

  const archiveParsed = ArchiveSchema.safeParse(parsedJson.body);
  if (archiveParsed.success) {
    const result = await archiveMemory(archiveParsed.data.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed to archive memory." }, { status: 500 });
    }
    return NextResponse.json(result);
  }

  const parsed = MemorySchema.required({ id: true }).safeParse(parsedJson.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid memory update data.", details: parsed.error.flatten() }, { status: 400 });
  }

  const projectKey = parsed.data.project_key ?? "global";
  const memories = await listActiveMemories({ projectKey, limit: 120 });
  const duplicate = findMemoryDuplicate(parsed.data, memories, parsed.data.id);
  if (duplicate) {
    return NextResponse.json({ error: "A similar active memory already exists.", duplicate }, { status: 409 });
  }

  const result = await updateMemory(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Failed to update memory." }, { status: 500 });
  }

  return NextResponse.json(result);
}
