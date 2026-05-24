# Production proof runner v1

This adds a repeatable command for verifying Rune production health from a trusted environment:

```bash
npm run proof:production
```

The script checks:

- `/api/self-test?suite=supabase`
- `/api/deploy-health`

It requires either `RUNE_INTERNAL_TOKEN` or `CRON_SECRET` in the environment running the proof. It sends the token as a bearer header and never prints the token.

## Safety boundary

This runner is read-only. It does not write memory, tasks, schemas, customers, payments, DNS, entitlements, or deployment state.

## Current blocker if it fails with `blocked: true`

The environment running the proof does not have `RUNE_INTERNAL_TOKEN` or `CRON_SECRET`. Add the internal token to the trusted automation environment, then rerun the proof.
