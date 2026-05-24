import { NextRequest, NextResponse } from "next/server";
import { logActionEvent } from "@/lib/action-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 8_000;

type CommandProvider = "twilio_whatsapp" | "whatsapp_cloud" | "manual_test";

function cleanText(value: unknown, maxChars = 500) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function configuredProviders(): CommandProvider[] {
  const providers: CommandProvider[] = [];
  if (process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM) providers.push("twilio_whatsapp");
  if (process.env.WHATSAPP_CLOUD_VERIFY_TOKEN && process.env.WHATSAPP_CLOUD_ACCESS_TOKEN) providers.push("whatsapp_cloud");
  if (process.env.RUNE_COMMAND_TEST_TOKEN) providers.push("manual_test");
  return providers;
}

function safeMetadata(req: NextRequest, bodyPreview: string) {
  return {
    route: "/api/commands/inbound",
    method: req.method,
    configuredProviders: configuredProviders(),
    hasTwilioSignature: Boolean(req.headers.get("x-twilio-signature")),
    hasMetaSignature: Boolean(req.headers.get("x-hub-signature-256")),
    bodyPreview: cleanText(bodyPreview, 500),
  };
}

async function recordBlockedProbe(req: NextRequest, bodyPreview = "") {
  await logActionEvent({
    eventType: "owned_command_inbound.blocked",
    summary: "Inbound command webhook received traffic before owned provider verification was configured.",
    status: "blocked",
    approvalStage: "none",
    riskLevel: "medium",
    projectKey: "rune",
    metadata: safeMetadata(req, bodyPreview),
  });
}

export async function GET(req: NextRequest) {
  const providers = configuredProviders();

  // WhatsApp Cloud API verification handshake. This only returns the challenge
  // when the owner-provided verify token is present and matches.
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_CLOUD_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token === expected && challenge) {
    await logActionEvent({
      eventType: "owned_command_inbound.verify",
      summary: "WhatsApp Cloud inbound command webhook verification challenge accepted.",
      status: "approved",
      approvalStage: "action",
      riskLevel: "low",
      projectKey: "rune",
      metadata: { route: "/api/commands/inbound", provider: "whatsapp_cloud" },
    });
    return new NextResponse(challenge, { status: 200 });
  }

  await recordBlockedProbe(req);
  return NextResponse.json({
    ok: false,
    blocked: true,
    route: "/api/commands/inbound",
    message: "Owned command inbound webhook is scaffolded but locked until provider verification is configured.",
    configuredProviders: providers,
    missingAnyOf: [
      "TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM",
      "WHATSAPP_CLOUD_VERIFY_TOKEN + WHATSAPP_CLOUD_ACCESS_TOKEN",
      "RUNE_COMMAND_TEST_TOKEN for local/manual tests",
    ],
  }, { status: 401 });
}

export async function POST(req: NextRequest) {
  const rawBody = (await req.text()).slice(0, MAX_BODY_CHARS);
  const providers = configuredProviders();

  // This scaffold intentionally does not trust or execute inbound commands yet.
  // Next PR should add provider-specific signature verification, owner allowlist,
  // command event persistence, queue handoff, and proof-backed response handling.
  await recordBlockedProbe(req, rawBody);

  return NextResponse.json({
    ok: false,
    blocked: true,
    route: "/api/commands/inbound",
    message: "Inbound command execution is locked until provider signature verification and owner allowlist are implemented.",
    configuredProviders: providers,
    nextRequiredProof: [
      "provider signature verification",
      "owner sender allowlist",
      "Supabase command event persistence",
      "queue/runner handoff",
      "outbound proof response through owned provider",
    ],
  }, { status: 403 });
}
