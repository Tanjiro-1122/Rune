# Jarvis Endgame Roadmap

## End goal

Jarvis should become Javier's private owner console: a secure, self-aware AI operating workspace that can remember project context, inspect and improve code, coordinate releases, prepare customer/support actions, and eventually operate approved external tools without depending on Base44 for private memory or project state.

Jarvis is not meant to become a public SaaS builder. The target is a private AI OS for Javier's apps and owner-only workflows.

## Non-negotiable operating rules

1. Private memory and project context live in Javier-owned Supabase, not public GitHub files.
2. New enduring memories and decisions are written to `agent_memories` with audit events in `agent_memory_events` / `jarvis_action_events`.
3. No raw private chat transcript imports by default. Only curated memory facts, rules, decisions, and project context.
4. No secrets, passwords, API keys, tokens, admin codes, private keys, or banking details in GitHub, docs, prompts, or memory imports.
5. Findings and plan come before file/repo/schema changes.
6. Code changes, PRs, schema changes, deployments, customer messages, financial reads, and banking actions require explicit Javier approval.
7. Jarvis should sound like Javier's private AI person: warm, direct, capable, honest, and momentum-oriented.

## Current state

Completed foundations:

- Canonical project registry for Jarvis, Unfiltr, SWH, and Unfiltr Family.
- Capability truth layer.
- Self-audit mode.
- Reasoning router.
- Repo Control proposals.
- Repo tree validation.
- Safe Repo Control ladder: inspect, diff, sandbox, temp workspace build.
- Approval-gated PR preparation foundation.
- Deployment inspection/proposal foundation.
- Supabase memory tables and memory event logging.
- Jarvis voice/personality layer.
- Upload handling and mobile-first private chat shell.

Remaining gap:

Jarvis can reason, inspect, propose, and safely rehearse. It still needs stronger hands: approved execution paths, persistent background jobs, external integrations, and owner-controlled memory migration from Base44/Saving Grace into Supabase.

## Exact phases from here

### Phase 1 — Memory Independence

Goal: make Supabase the primary durable memory layer.

Steps:

1. Keep `JARVIS_OWNER_MEMORY` as an optional bootstrap only.
2. Use `agent_memories` as the source of truth for enduring facts, rules, decisions, and project context.
3. Import only curated safe memories, never raw chat logs.
4. Add dry-run import preview before any memory write.
5. Log every import preview/import to `jarvis_action_events`.
6. Add duplicate detection and secret/raw-chat guards.
7. After successful import, rotate/remove `JARVIS_MEMORY_SEED_TOKEN` if it is no longer needed.

Implemented in this patch:

- `lib/memory-import.ts`
- `POST /api/memory/import`
- dry-run/import modes
- `approved=true` required for actual import
- duplicate checks
- secret/token/raw-chat guards
- action-event logging

### Phase 2 — Hands Phase 1: Approved Code Execution

Goal: approved proposal -> apply branch changes -> open PR -> track checks.

Steps:

1. Proposal must be approved.
2. Generate or reuse reviewed diff.
3. Run sandbox safety check.
4. Run temporary workspace build.
5. Create branch and PR only after gates pass.
6. Never merge automatically.
7. Never deploy automatically.
8. Summarize PR/check state in owner language.

### Phase 3 — Deployment Control

Goal: approved PR/release -> inspect deployment -> prepare redeploy/rollback -> execute only after exact approval.

Steps:

1. Keep deployment inspection read-only by default.
2. Add approval objects for redeploy/rollback.
3. Add execution endpoint with exact-action approval.
4. Log every deployment action.
5. Add post-deploy health verification.
6. Keep rollback as a prepared, approval-gated action.

### Phase 4 — Integrations

Goal: connect owner services safely.

Priority order:

1. GitHub/Vercel deeper control.
2. Supabase project visibility.
3. RevenueCat read-only status first; grants later with approval.
4. App Store Connect / Google Play read-only first; release actions later with approval.
5. Support email drafting first; sending later with approval.
6. Financial reads last; banking actions only after major hardening.

### Phase 5 — Persistent Operator

Goal: reduce timeout dependence.

Steps:

1. Add persistent job queue backed by Supabase.
2. Add resumable work plans and checkpoints.
3. Add background worker/runner integration.
4. Store every stage result as an action event/artifact.
5. Let Javier return later and ask for status without losing context.

## Overnight work boundary

Safe to do without Javier awake:

- Read/audit code.
- Write docs.
- Add dry-run tools.
- Add guarded endpoints that do nothing destructive by default.
- Run tests/builds/typechecks.
- Push verified commits.

Not safe without Javier awake:

- Run Supabase schema changes in production.
- Import private/raw memories into production.
- Move secrets.
- Merge PRs.
- Deploy/rollback production.
- Send customer messages.
- Connect financial/banking actions.
