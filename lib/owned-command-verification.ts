import crypto from "node:crypto";

export type OwnedCommandProvider = "twilio_whatsapp" | "whatsapp_cloud" | "manual_test";

export interface OwnedCommandVerificationInput {
  provider: OwnedCommandProvider;
  rawBody: string;
  url?: string;
  headers?: Headers | Record<string, string | string[] | undefined | null>;
  searchParams?: URLSearchParams;
  env?: Record<string, string | undefined>;
}

export interface OwnedCommandVerificationResult {
  ok: boolean;
  provider: OwnedCommandProvider;
  reason?: string;
  sender?: string | null;
  commandText?: string;
  proof: {
    signatureVerified: boolean;
    ownerAllowed: boolean;
    executionEnabled: false;
  };
  metadata: Record<string, unknown>;
}

function getHeader(headers: OwnedCommandVerificationInput["headers"], name: string): string {
  if (!headers) return "";
  if (headers instanceof Headers) return headers.get(name) ?? "";
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return value[0] ?? "";
    return value ?? "";
  }
  return "";
}

function safeText(value: unknown, maxChars = 1000): string {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/^whatsapp:/i, "").replace(/[^0-9+]/g, "").trim();
}

function allowedSenders(env: Record<string, string | undefined>): string[] {
  return String(env.RUNE_COMMAND_OWNER_SENDERS ?? env.RUNE_OWNER_WHATSAPP_NUMBERS ?? "")
    .split(/[;,\n]/)
    .map(normalizePhone)
    .filter(Boolean);
}

function isOwnerAllowed(sender: string | null | undefined, env: Record<string, string | undefined>) {
  const normalized = normalizePhone(sender);
  const allowed = allowedSenders(env);
  return Boolean(normalized && allowed.includes(normalized));
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyTwilioSignature(input: OwnedCommandVerificationInput, env: Record<string, string | undefined>) {
  const token = env.TWILIO_AUTH_TOKEN ?? "";
  const signature = getHeader(input.headers, "x-twilio-signature");
  const url = input.url ?? "";
  if (!token) return { ok: false, reason: "missing TWILIO_AUTH_TOKEN" };
  if (!signature) return { ok: false, reason: "missing x-twilio-signature" };
  if (!url) return { ok: false, reason: "missing request url for Twilio signature base" };

  const params = new URLSearchParams(input.rawBody);
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const base = url + sorted.map(([key, value]) => `${key}${value}`).join("");
  const expected = crypto.createHmac("sha1", token).update(base).digest("base64");
  return { ok: timingSafeEqual(expected, signature), reason: "signature mismatch" };
}

function verifyMetaSignature(input: OwnedCommandVerificationInput, env: Record<string, string | undefined>) {
  const appSecret = env.WHATSAPP_CLOUD_APP_SECRET ?? env.META_APP_SECRET ?? "";
  const signature = getHeader(input.headers, "x-hub-signature-256");
  if (!appSecret) return { ok: false, reason: "missing WHATSAPP_CLOUD_APP_SECRET or META_APP_SECRET" };
  if (!signature?.startsWith("sha256=")) return { ok: false, reason: "missing x-hub-signature-256" };
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(input.rawBody).digest("hex")}`;
  return { ok: timingSafeEqual(expected, signature), reason: "signature mismatch" };
}

function verifyManual(input: OwnedCommandVerificationInput, env: Record<string, string | undefined>) {
  const expected = env.RUNE_COMMAND_TEST_TOKEN ?? "";
  const provided = getHeader(input.headers, "x-rune-command-test-token") || input.searchParams?.get("token") || "";
  if (!expected) return { ok: false, reason: "missing RUNE_COMMAND_TEST_TOKEN" };
  if (!provided) return { ok: false, reason: "missing manual test token" };
  return { ok: timingSafeEqual(expected, provided), reason: "manual test token mismatch" };
}

function parseTwilio(rawBody: string) {
  const params = new URLSearchParams(rawBody);
  return {
    sender: params.get("From"),
    commandText: safeText(params.get("Body"), 1500),
    messageId: params.get("MessageSid"),
  };
}

function parseMeta(rawBody: string) {
  try {
    const json = JSON.parse(rawBody) as any;
    const value = json?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    return {
      sender: message?.from ? `+${String(message.from).replace(/^\+/, "")}` : null,
      commandText: safeText(message?.text?.body ?? "", 1500),
      messageId: message?.id,
    };
  } catch {
    return { sender: null, commandText: "", messageId: null };
  }
}

function parseManual(rawBody: string) {
  try {
    const json = JSON.parse(rawBody) as { sender?: string; text?: string; command?: string };
    return { sender: json.sender ?? null, commandText: safeText(json.text ?? json.command ?? "", 1500), messageId: null };
  } catch {
    const params = new URLSearchParams(rawBody);
    return { sender: params.get("sender"), commandText: safeText(params.get("text") ?? params.get("command"), 1500), messageId: null };
  }
}

export function verifyOwnedCommand(input: OwnedCommandVerificationInput): OwnedCommandVerificationResult {
  const env = input.env ?? process.env;
  const parsed = input.provider === "twilio_whatsapp"
    ? parseTwilio(input.rawBody)
    : input.provider === "whatsapp_cloud"
      ? parseMeta(input.rawBody)
      : parseManual(input.rawBody);

  const signature = input.provider === "twilio_whatsapp"
    ? verifyTwilioSignature(input, env)
    : input.provider === "whatsapp_cloud"
      ? verifyMetaSignature(input, env)
      : verifyManual(input, env);

  const ownerAllowed = isOwnerAllowed(parsed.sender, env);
  const ok = signature.ok && ownerAllowed && Boolean(parsed.commandText);

  return {
    ok,
    provider: input.provider,
    reason: ok ? undefined : !signature.ok ? signature.reason : !ownerAllowed ? "sender not allowlisted" : "empty command text",
    sender: normalizePhone(parsed.sender),
    commandText: parsed.commandText,
    proof: {
      signatureVerified: signature.ok,
      ownerAllowed,
      executionEnabled: false,
    },
    metadata: {
      provider: input.provider,
      messageId: parsed.messageId ?? null,
      senderPresent: Boolean(parsed.sender),
      commandChars: parsed.commandText.length,
      allowedSenderCount: allowedSenders(env).length,
    },
  };
}

export function pickOwnedCommandProvider(headers: Headers, searchParams?: URLSearchParams): OwnedCommandProvider | null {
  if (headers.get("x-twilio-signature")) return "twilio_whatsapp";
  if (headers.get("x-hub-signature-256")) return "whatsapp_cloud";
  if (headers.get("x-rune-command-test-token") || searchParams?.get("token")) return "manual_test";
  return null;
}
