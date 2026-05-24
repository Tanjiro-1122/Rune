# Owned command inbound production proof v1

Rune's owned command channel must be proven in stages. The first safe production proof is not command execution; it is proving the inbound command webhook is deployed and refuses to execute unverified traffic.

## What this proof checks

`npm run proof:owned-command-inbound` calls production `/api/commands/inbound` and expects:

- `GET /api/commands/inbound` without a valid provider verification token returns `401` with `blocked: true`.
- `POST /api/commands/inbound` returns `403` with `blocked: true`.
- The POST response lists the missing proof needed before command execution, including provider signature verification.

## Middleware boundary

The production webhook path must be allowed through `middleware.ts` so the route handler can perform provider-specific verification and return the locked contract. Middleware should not try to validate WhatsApp/Twilio signatures because the route handler needs provider-specific headers and raw body handling.

The route must still block execution by default until signature verification, owner allowlist, command persistence, queue handoff, and owned outbound proof responses are implemented.

## What this proof does not do

- It does not execute commands.
- It does not send outbound WhatsApp messages.
- It does not merge, deploy, mutate schema, touch payments, grant entitlements, change DNS, or message customers.
- It does not prove full Base44 replacement.

## Why this matters

This proves the owned command-control path exists in production while staying locked by default. That is the correct safety posture before adding provider signatures, owner sender allowlists, Supabase command event persistence, queue handoff, and owned outbound proof responses.

## Local command

```bash
npm run proof:owned-command-inbound
```

Optional override:

```bash
RUNE_LIVE_URL=https://mrruneai.vercel.app npm run proof:owned-command-inbound
```
