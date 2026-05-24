# Base44 shutdown drill v1

Rune should not be treated as safe for Base44 cancellation until it passes a repeatable shutdown drill.

This first drill adds a source-level runtime dependency proof:

```bash
npm run proof:base44-shutdown-drill
```

The proof checks that active code does not call Base44 runtime APIs or Base44 entity imports. It also writes `docs/reports/base44-shutdown-drill-latest.md` with the current inventory of Base44 references.

Allowed references include docs, migration notes, compatibility env names, and smoke tests that intentionally mention Base44. Active runtime references are not allowed.

This is not the final cancellation proof. The remaining gates are:

1. Rune production Supabase proof with internal auth.
2. Rune live chat harmless repo-task proof.
3. Owned command channel proof outside Base44.
4. GitHub/Vercel repo-operation proof.
5. Unfiltr/SWH/CriticalCritic health proof without Base44 runtime.
6. Secrets/provider map stored outside Base44.

No customer, payment, entitlement, DNS, schema, or deploy mutation is part of this drill.
