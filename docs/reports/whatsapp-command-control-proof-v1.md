# WhatsApp command/control proof v1

Rune should not be considered a Base44 Superagent replacement just because it can generate a daily briefing.

The current state is useful, but briefing-only is not command/control. Phase 4 requires an owned channel where Javier can send commands to Rune outside Base44 and Rune can respond with proof.

## Current foundation

- Daily operator briefing composer exists in `lib/whatsapp-briefing.ts`.
- Daily briefing cron exists in `app/api/cron/daily-briefing/route.ts`.
- Owned outbound persistence foundation exists through `rune_outbox`.
- Rune already has privileged operation gates for dangerous actions.

## Required owned-channel capabilities

### Inbound command webhook

Rune needs a dedicated inbound command webhook for an owned provider such as Twilio WhatsApp, WhatsApp Cloud API, or another approved command channel.

Minimum requirements:

- authenticate/verify provider signatures,
- map inbound sender to Javier/owner identity,
- reject unknown senders by default,
- normalize message text/files into a command event,
- persist command events to Supabase,
- return a fast acknowledgement,
- hand long work to the queue/runner instead of blocking the webhook.

### Outbound delivery provider

Rune needs an outbound delivery provider that is not Base44-only.

Minimum requirements:

- read queued responses from `rune_outbox` or an equivalent table,
- send status/proof updates back to Javier,
- separate owner messages from customer-facing messages,
- retry safely without duplicate spam,
- log delivery status and failures.

### Approval gate

High-risk commands must remain gated even over WhatsApp.

Examples requiring exact approval phrases:

- merge to main,
- deploy/rollback,
- payment changes,
- entitlement grants,
- DNS changes,
- schema mutations,
- customer messages.

### Proof response contract

A command response is not complete unless Rune can report the relevant proof:

- PR URL and head SHA,
- merge commit if merged,
- default-branch proof,
- deployment URL/status if deployed,
- live smoke proof if applicable,
- memory/task/action event persistence proof.

## Non-goals and safety

- No customer messages without explicit approval.
- No payment, entitlement, DNS, or schema mutation from this proof contract.
- No claim that WhatsApp briefing equals owned command/control.
- No claim that Rune has replaced Base44 channels until inbound and outbound proof pass in production.

## Current honest status

Rune has briefing/outbox foundations. It does not yet have a verified owned inbound WhatsApp command webhook on main.


## Scaffold added after v1 proof

`/api/commands/inbound` is now the locked inbound-command scaffold. It is intentionally not a working command executor yet.

Current behavior:

- WhatsApp Cloud verification challenge can only pass when `WHATSAPP_CLOUD_VERIFY_TOKEN` matches.
- POST requests are blocked until provider signature verification and owner sender allowlist are implemented.
- Blocked probes are logged to `rune_action_events` when Supabase is configured.
- No outbound messages, merges, deploys, payment changes, entitlement grants, DNS changes, or schema mutations occur.

Next implementation proof must add provider-specific signature verification, owner allowlist, command event persistence, queue/runner handoff, and owned outbound proof responses.

## Local verification

```bash
npm run test:whatsapp-command-control-proof
```
