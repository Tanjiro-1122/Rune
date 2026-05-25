import { NextRequest, NextResponse } from "next/server";
import { logActionEvent } from "@/lib/action-events";
import { pickOwnedCommandProvider, verifyOwnedCommand } from "@/lib/owned-command-verification";

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
  const provider = pickOwnedCommandProvider(req.headers, req.nextUrl.searchParams);

  if (!provider) {
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

  const verification = verifyOwnedCommand({
    provider,
    rawBody,
    url: req.url,
    headers: req.headers,
    searchParams: req.nextUrl.searchParams,
  });

  await logActionEvent({
    eventType: verification.ok ? "owned_command_inbound.verified" : "owned_command_inbound.rejected",
    summary: verification.ok
      ? "Inbound owned command verified and persisted, but execution remains disabled pending queue handoff."
      : `Inbound owned command rejected: ${verification.reason ?? "verification failed"}.`,
    status: verification.ok ? "approved" : "blocked",
    approvalStage: verification.ok ? "approval" : "none",
    riskLevel: verification.ok ? "medium" : "medium",
    projectKey: "rune",
    metadata: {
      ...verification.metadata,
      proof: verification.proof,
      reason: verification.reason ?? null,
    },
  });

  if (!verification.ok) {
    return NextResponse.json({
      ok: false,
      blocked: true,
      route: "/api/commands/inbound",
      provider,
      reason: verification.reason,
      proof: verification.proof,
    }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    accepted: true,
    blocked: true,
    route: "/api/commands/inbound",
    provider,
    message: "Command verified and persisted, but execution remains locked until queue/runner handoff and outbound proof response are implemented.",
    proof: verification.proof,
    nextRequiredProof: [
      "Supabase command event persistence verified in production",
      "queue/runner handoff",
      "outbound proof response through owned provider",
    ],
  }, { status: 202 });
}
