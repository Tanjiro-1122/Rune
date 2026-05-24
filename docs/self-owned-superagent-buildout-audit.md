# Rune self-owned Superagent buildout audit

Last audited baseline: `9e412b811a43656e32df6ed42929d47bb8c30668`.

Rune's goal is to become Javier's personally owned app/repo/business operator. It should reduce day-to-day dependence on Base44 by replacing managed platform conveniences with owned infrastructure: Vercel, Supabase, GitHub, WhatsApp/Twilio, queues/workers, browser automation, OpenAI/Anthropic, and custom connectors.

This document intentionally does **not** claim exact Base44 or Emergent parity. It tracks proof-backed progress toward an owned replacement.

## Current verified strengths

- Production app responds at `https://mrruneai.vercel.app`.
- Auth redirect works for unauthenticated owner access.
- Proof-first repo operator core is merged on main.
- Repo action completion verifier exists on main.
- Fake-completion/reality guard tests exist.
- Operator executor proof contract exists.
- App Forge proof contracts exist for queued repo creation and preview deploy paths.
- Supabase-backed memory/task/action tables are referenced throughout the codebase.
- Daily briefing and cron/operator routes exist.
- Privileged merge/deploy/rollback/payment/entitlement/schema/DNS/customer-system gates exist as safety scaffolding.

## Current gaps before Base44 Superagent cancellation

### 1. Live chat proof test

Rune must prove from the real production chat UI that it can:

1. accept a harmless repo task,
2. open a real PR,
3. report PR URL/branch/SHA proof,
4. refuse to call the task complete until merge/default-branch proof exists,
5. verify deployment/live smoke where applicable,
6. write durable memory/action evidence.

Status: required before treating Rune as a trusted repo operator.

### 2. Branch and PR reconciliation

The repository contains many remote branches that are not ancestry-merged into main. Many are likely stale or squash-merged historical branches. They must be classified before any broad merge work.

Initial open PR found:

- PR #175 — `Add privileged deploy and rollback gates`
  - Appears stale/overlapped with newer main safety work because main already contains `runPrivilegedDeployment` wiring and privileged operation route support.
  - Do not merge wholesale without a conflict-aware salvage review.

### 3. Owned command channel

Rune needs command input outside Base44, preferably WhatsApp/Twilio or another owner-controlled channel.

Minimum command examples:

- `check Rune health`
- `check SWH checkout`
- `open a harmless docs PR`
- `summarize failed CI`
- `prepare deploy gate`

Risky commands must require exact approval phrases and proof scope.

### 4. Supabase memory and task proof

Rune must prove production writes and reads for:

- owner/project memory,
- task state,
- action events,
- completion evidence,
- decision history,
- briefing logs.

Status: code exists, but live table/schema verification must be completed.

### 5. Background worker reliability

Long-running jobs must not depend on one chat request. Rune needs a reliable queue/worker flow with retry, failure bundles, checkpointing, and owner-facing status.

### 6. Browser automation and connector layer

Rune needs owned tool equivalents for common Superagent work:

- browser inspection and smoke tests,
- GitHub,
- Vercel,
- Supabase,
- Stripe/RevenueCat read-only first,
- App Store / Google Play read-only first,
- Resend/Twilio,
- Gmail/Calendar/Drive later if needed.

### 7. App Forge owned app creation loop

Rune must prove it can create a simple new app from idea to repo/preview with proof:

1. product plan,
2. GitHub repo or branch,
3. generated scaffold,
4. tests/build,
5. Vercel preview,
6. live smoke,
7. memory/project registration.

## Cancellation gates

Base44 should not be canceled until these gates pass:

1. Customer-facing apps survive a Base44-runtime shutdown drill.
2. Rune production chat completes a harmless repo PR task with proof.
3. Rune can receive and respond to owner commands outside Base44.
4. Rune production Supabase memory/task/action writeback is verified.
5. Rune can inspect and report health for Unfiltr, SWH, CriticalCritic, and Rune.
6. A documented secrets/provider map exists outside Base44.

## Timeframe estimate

- App runtime independence verification: 2–4 focused days.
- Minimum Rune replacement for day-to-day repo/app operations: 2–3 weeks.
- Comfortable Base44 Superagent cancellation: 4–6 weeks.
- Strong owned Superagent / app creator: 8–12 weeks.

## Operating rule

No proof means no done.

Every material task should report:

- PR URL,
- branch,
- commit SHA,
- merge SHA if merged,
- default-branch verification,
- deployment URL/status if deployed,
- live smoke result if applicable,
- memory/action writeback result if applicable.
