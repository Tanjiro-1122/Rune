# Supabase persistence proof contract v1

Rune should not be considered Base44-optional until its owned persistence layer is proven in production.

This contract tracks the minimum Supabase persistence proof Rune needs for owner memory, task state, action history, and briefing history.

## Required tables

- `agent_memories`
- `agent_memory_events`
- `rune_action_events`
- `workspace_tasks`
- `workspace_task_runs`
- `rune_tasks`
- `rune_reminders`
- `rune_outbox`
- `briefing_log`

## Required runtime secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Aliases may exist for compatibility, but production should have the canonical names above configured for server-side persistence.

## Required live proof

Before Base44 Superagent cancellation, collect production evidence for:

1. `/api/self-test?suite=supabase` returns healthy table reachability.
2. `/api/deploy-health` reports Supabase configured and required tables reachable.
3. A harmless owner memory write/read succeeds through Rune's normal memory path.
4. A harmless task create/update/checkpoint succeeds through Rune's task path.
5. A harmless action event write/read succeeds through `rune_action_events`.
6. Daily briefing output is persisted or explicitly reports why `briefing_log` is unavailable.

## Safety

The smoke test added with this contract is read-only. It checks source-code/schema coverage and does not write production data.

Production write proof must use explicit harmless probe records and clean them up, or mark them as self-test records. Do not mutate customer, payment, entitlement, DNS, or schema data as part of this proof.

## Local verification

```bash
npm run test:supabase-persistence-proof-contract
```
