# Owned command provider readiness v1

Rune's owned command channel is now deployed and locked by default at `/api/commands/inbound`.

This document defines the provider-readiness contract before real command execution can be enabled.

## Supported provider paths

### Twilio WhatsApp

Required production env:

- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`

Still required before execution:

- provider signature verification using Twilio's `X-Twilio-Signature`
- owner sender allowlist
- Supabase command event persistence
- queue/runner handoff
- outbound proof response through owned provider

### WhatsApp Cloud API

Required production env:

- `WHATSAPP_CLOUD_VERIFY_TOKEN`
- `WHATSAPP_CLOUD_ACCESS_TOKEN`

Already scaffolded:

- GET verification challenge can succeed only when `hub.verify_token` matches `WHATSAPP_CLOUD_VERIFY_TOKEN`.

Still required before execution:

- provider signature verification using Meta's `X-Hub-Signature-256`
- owner sender allowlist
- Supabase command event persistence
- queue/runner handoff
- outbound proof response through owned provider

### Manual/self-test provider

Required production or preview env:

- `RUNE_COMMAND_TEST_TOKEN`

Purpose:

- proves the command path in preview/staging without connecting a live messaging provider.
- must still remain owner-only and locked behind explicit verification.

## Current safe state

The route may report configured providers, but it must not execute commands until the next proof stages exist.

Required next proof before any execution claim:

1. provider signature verification
2. owner sender allowlist
3. Supabase command event persistence
4. queue/runner handoff
5. outbound proof response through owned provider

## Local verification

```bash
npm run test:owned-command-provider-readiness
npm run proof:owned-command-inbound
```

`proof:owned-command-inbound` proves production currently responds safely: GET is locked/verified-only and POST is blocked until the required proof exists.

## Safety boundary

This is not Base44 parity. It is the owned-command-channel foundation. No customer messages, payment changes, DNS changes, entitlement grants, schema changes, merges, or deploys are allowed from inbound commands until proof-backed execution is separately implemented and gated.
