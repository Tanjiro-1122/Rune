import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { previewOrImportMemories } from "@/lib/memory-import";

const KindSchema = z.enum(["identity", "owner", "project", "rule", "workflow", "decision", "safety", "note"]);

const ImportItemSchema = z.object({
  kind: KindSchema.optional(),
  title: z.string().min(1).max(180),
  content: z.string().min(1).max(4000),
  project_key: z.string().max(80).nullable().optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  source: z.string().max(80).optional(),
});

const ImportSchema = z.object({
  mode: z.enum(["dry_run", "import"]).optional().default("dry_run"),
  approved: z.boolean().optional().default(false),
  source: z.string().max(80).optional(),
  items: z.array(ImportItemSchema).min(1).max(100),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid memory import payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await previewOrImportMemories(parsed.data);
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
