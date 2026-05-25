/**
 * Rune Email — Resend
 * -------------------
 * Uses RESEND_API_KEY + RESEND_FROM env vars.
 * Falls back to onboarding@resend.dev (Resend test sender) if RESEND_FROM not set.
 *
 * No SMTP, no outbox queue, no Gmail App Password dependency.
 * Works in Vercel serverless Edge and Node runtimes.
 */

export interface EmailOptions {
  to: string;
  subject: string;
  body: string;       // plain text
  html?: string;      // optional HTML version
}

export interface EmailResult {
  sent: boolean;
  to?: string;
  subject?: string;
  messageId?: string;
  error?: string;
}

export async function sendEmail(opts: EmailOptions): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim() ?? "Rune <onboarding@resend.dev>";

  if (!apiKey) {
    return { sent: false, error: "RESEND_API_KEY not configured in Vercel env vars." };
  }

  try {
    const payload: Record<string, unknown> = {
      from,
      to: [opts.to],
      subject: opts.subject,
      text: opts.body,
    };
    if (opts.html) {
      payload.html = opts.html;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        sent: false,
        error: `Resend API ${res.status}: ${detail.slice(0, 240)}`,
      };
    }

    const data = (await res.json()) as { id?: string };
    return {
      sent: true,
      to: opts.to,
      subject: opts.subject,
      messageId: data.id ?? undefined,
    };
  } catch (e) {
    return {
      sent: false,
      error: e instanceof Error ? e.message : "Email send failed",
    };
  }
}
