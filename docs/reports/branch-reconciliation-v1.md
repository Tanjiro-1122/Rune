# Rune branch reconciliation report v1

Baseline: current `origin/main` after PR #182 (`6f456150ec241ab24393861fa8b7069303f84e72`).

Purpose: reduce the branch graveyard safely. This report does not delete or merge branches. It classifies risk and sets the next salvage order.

## Summary

- Branches ahead of main in full script output: 158
- Many large branches are old divergent histories and must not be merged wholesale.
- The safest cleanup path is: close already-superseded PRs, preserve current main, then salvage individual missing ideas into fresh tiny PRs.

## Immediate decisions

- PR #182 was merged first because it was docs/script only and establishes this audit process.
- PR #175 was closed as superseded because current main already contains privileged deploy/rollback wiring and smoke tests.
- No customer/payment/DNS/schema/entitlement changes were made.

## Do not merge wholesale

- `origin/fix/no-outlining-no-freeze` — 534 ahead / 101 behind — `ed655af` fix: remove Reasoning Router consulting-outlining lines from system prompt — likely stale/divergent — do not merge wholesale
- `origin/fix/set-attachments-undefined` — 531 ahead / 101 behind — `21fd2f6` fix(build): replace undefined setAttachments with setPreviewUrls in handleScreenshotPaste — likely stale/divergent — do not merge wholesale
- `origin/fix/plan-route-type-error` — 530 ahead / 101 behind — `9c42183` fix(build): cast reasoningRoute comparison to string in plan/route.ts — likely stale/divergent — do not merge wholesale
- `origin/fix/chat-tsx-fragment-and-scope` — 529 ahead / 101 behind — `1b0960b` fix(chat): close JSX fragment in RuneCodeBlock + remove out-of-scope shimmer bar ref — likely stale/divergent — do not merge wholesale
- `origin/fix/nested-template-literal-final` — 528 ahead / 101 behind — `58e928e` fix(build): fix broken nested template literals in system prompt — Rune builds — likely stale/divergent — do not merge wholesale
- `origin/fix/route-backtick-v3` — 527 ahead / 101 behind — `87cd477` fix(build): strip stray backtick from L2738, insert proper template literal close — likely stale/divergent — do not merge wholesale
- `origin/fix/backtick-syntax-error-route` — 526 ahead / 101 behind — `42a1e6c` fix(route): remove stray backtick in system prompt that broke template literal — likely stale/divergent — do not merge wholesale
- `origin/feat/briefing-log-storage` — 525 ahead / 101 behind — `47d9699` feat(cron): save daily briefing output to briefing_log table — likely stale/divergent — do not merge wholesale
- `origin/fix/audit-clean-planning-remnants` — 524 ahead / 101 behind — `9d75444` fix(agent-work-loop): remove plan phase + plan_first dependency — likely stale/divergent — do not merge wholesale
- `origin/fix/ios-keyboard-overlap-and-stale-comment` — 524 ahead / 101 behind — `534fafb` fix(comments): remove stale gpt-4o references — model is gpt-4.1 — likely stale/divergent — do not merge wholesale
- `origin/fix/missing-supabase-tables` — 524 ahead / 101 behind — `2978be2` fix(db): add missing rune_reminders, rune_outbox, briefing_log tables — likely stale/divergent — do not merge wholesale
- `origin/fix/chat-ui-parity-and-outlining-voice` — 523 ahead / 101 behind — `2703c6e` feat(ui): wire shimmer bar to chat loading state — likely stale/divergent — do not merge wholesale
- `origin/fix/kill-work-loop-planner-remnants` — 520 ahead / 101 behind — `6af22fa` fix(chat): gut agentWorkLoop injection + planner forced tool priority — both cause outlining — likely stale/divergent — do not merge wholesale
- `origin/fix/planner-ui-only` — 519 ahead / 101 behind — `724b0d3` fix(chat): remove planner auto-injection from system prompt — planner is UI-only via button — likely stale/divergent — do not merge wholesale
- `origin/fix/planner-kills-outlining` — 518 ahead / 101 behind — `779f353` fix(prompt): kill plan_first outlining — zero tolerance for pre-announcing — likely stale/divergent — do not merge wholesale
- `origin/fix/act-dont-outline` — 517 ahead / 101 behind — `b38ce54` fix(prompt): ban outlining — act immediately, no pre-announcing steps — likely stale/divergent — do not merge wholesale
- `origin/fix/image-paste` — 517 ahead / 101 behind — `3a8c116` fix(chat): paste images as attachments not markdown — renders preview + sends to AI vision — likely stale/divergent — do not merge wholesale
- `origin/feat/owner-trust-mfa` — 515 ahead / 101 behind — `d64b28f` feat(owner): full owner trust model + 1122 MFA verify — likely stale/divergent — do not merge wholesale
- `origin/copilot/audit-application-structure` — 425 ahead / 101 behind — `20f6862` feat(model): upgrade to gpt-4.1 — 1M context, better instruction following, lower cost — copilot branch — inspect manually before salvage
- `origin/pr-80-hands-phase1` — 329 ahead / 101 behind — `805d0c3` fix: add missing hands.ts import to chat route (#80) — likely stale/divergent — do not merge wholesale

## Current salvage candidates

These branches look related to the current owned-Superagent path. They should be inspected one-by-one and salvaged only if main lacks the capability.

- `origin/feature/operator-self-diagnostic-routing` — 265 ahead / 101 behind — `b8b9384` fix: route operator diagnostics away from datetime tool — likely stale/divergent — do not merge wholesale
- `origin/feature/operator-briefing-final-warning-normalizer` — 263 ahead / 101 behind — `5aa7837` fix: normalize final operator briefing warning status — likely stale/divergent — do not merge wholesale
- `origin/feature/operator-briefing-external-warning` — 261 ahead / 101 behind — `4f20e09` fix: render external integration gaps as briefing warnings — likely stale/divergent — do not merge wholesale
- `origin/feature/operator-warning-wording-polish` — 259 ahead / 101 behind — `e4e1ebf` fix: soften operator integration visibility warnings — likely stale/divergent — do not merge wholesale
- `origin/feature/operator-briefing-card` — 257 ahead / 101 behind — `252e192` feat: surface daily operator briefing in console — likely stale/divergent — do not merge wholesale
- `origin/feature/daily-operator-briefing` — 255 ahead / 101 behind — `7c4d679` feat: add daily operator briefing composer — likely stale/divergent — do not merge wholesale
- `origin/feature/repo-action-completion-verifier-v1` — 5 ahead / 2 behind — `23af7ac` Require App Forge runner proof on completion — likely superseded by proof-loop main — verify then close/delete
- `origin/fix/briefing-operator-readiness-score` — 1 ahead / 82 behind — `c7beabe` fix: report operator readiness in daily briefing — review
- `origin/fix/operator-asc-remediation` — 1 ahead / 64 behind — `07bf7ca` fix: close App Store Connect health remediation loop — review
- `origin/fix/operator-mode-v1-visible-remediation` — 1 ahead / 63 behind — `8d72a5b` feat: create visible remediation tasks from health findings — review
- `origin/feat/operator-executor-bridge-v1` — 1 ahead / 62 behind — `d649ad9` feat: add operator executor bridge v1 — review
- `origin/feat/operator-executor-bridge-v2` — 1 ahead / 61 behind — `ff4318d` feat: extend operator executor to approved PR gate — review
- `origin/feat/operator-retry-recovery-v3` — 1 ahead / 60 behind — `b32c4da` feat: add operator retry and failure recovery policy — review
- `origin/feat/operator-event-queue-v1` — 1 ahead / 59 behind — `f26c1f0` feat: add operator event queue v1 — review
- `origin/feat/operator-event-cron-schedule` — 1 ahead / 58 behind — `b3d02f0` feat: schedule operator event queue cron — review
- `origin/feat/simple-builder-entrypoint` — 1 ahead / 35 behind — `6a0f714` feat: add honest simple builder entrypoint — review
- `origin/fix/simple-builder-routing` — 1 ahead / 34 behind — `a97bdaf` fix: route build requests to simple builder — review
- `origin/fix/base44-runtime-guard` — 1 ahead / 33 behind — `45edfce` fix: remove active Base44 runtime paths — review
- `origin/cleanup/remove-final-base44-aliases` — 1 ahead / 32 behind — `6a340e5` cleanup: remove final Base44 env and media aliases — review
- `origin/fix/base44-exit-registry` — 1 ahead / 31 behind — `80ee1d2` Mark cleaned apps as Base44 removed — review
- `origin/feature/operator-executor-cron` — 1 ahead / 30 behind — `4c8ad3b` Add safe operator executor cron automation — review
- `origin/feature/app-forge-v1-repo-handoff` — 1 ahead / 29 behind — `f7eed81` Add App Forge repo handoff — review
- `origin/feature/app-forge-v2-runner` — 1 ahead / 28 behind — `045c35b` Add App Forge v2 trusted runner — review
- `origin/feature/app-forge-v2-scaffold-hardening` — 1 ahead / 27 behind — `ccca31d` Harden App Forge v2 scaffold generation — review
- `origin/feature/app-forge-v3-preview-handoff` — 1 ahead / 26 behind — `0e16f4c` Add App Forge v3 preview handoff — review
- `origin/feature/app-forge-v4-preview-runner` — 1 ahead / 25 behind — `a39f496` Add App Forge v4 preview runner — review
- `origin/feature/app-forge-v4-preview-runner-fix` — 1 ahead / 24 behind — `5ce5567` Fix App Forge preview runner project slug — review
- `origin/feature/app-forge-v4-target-guard` — 1 ahead / 23 behind — `9ae87ca` Guard App Forge preview deployment target — review
- `origin/feature/operator-priority-brain-v1` — 1 ahead / 21 behind — `c2b94e2` Add operator priority brain v1 — review
- `origin/feature/operator-decision-explainer-v1` — 1 ahead / 20 behind — `3cad332` Add operator decision explainer — review
- `origin/feature/operator-memory-writeback-v1` — 1 ahead / 19 behind — `edffde2` Add operator decision memory writeback — review
- `origin/feature/operator-decision-history-v1` — 1 ahead / 18 behind — `1903578` Add operator decision history — review
- `origin/feature/operator-root-cause-runbook-v1` — 1 ahead / 17 behind — `63d8f3c` Add operator root-cause runbook — review
- `origin/feature/operator-completion-ledger-v1` — 1 ahead / 16 behind — `8834f34` Add operator completion ledger — review
- `origin/feature/operator-outcome-scoring-v1` — 1 ahead / 15 behind — `43762e3` Add operator outcome scoring — review
- `origin/feature/whatsapp-operator-brain-summary-v1` — 1 ahead / 14 behind — `bc7e074` Add operator brain summary to WhatsApp briefing — review
- `origin/feature/operator-failure-evidence-bundles-v1` — 1 ahead / 13 behind — `5706339` Add operator failure evidence bundles — review
- `origin/feature/operator-repo-access-capability-v1` — 1 ahead / 12 behind — `77b2449` Add repo access capability gate — review
- `origin/feature/privileged-operations-control-plane-v1` — 1 ahead / 11 behind — `df5f7f6` Add privileged operations control plane — review
- `origin/feature/privileged-gated-merge-v1` — 1 ahead / 10 behind — `be4caa7` Add gated privileged merge — review

## Recommended next order

1. Verify main already includes every recent proof-loop branch; close/delete superseded branches later.
2. Inspect `operator-*` branches for missing memory/writeback/reporting behavior.
3. Inspect `app-forge-*` branches for missing runner/preview proof behavior.
4. Inspect `base44-*` cleanup branches for harmless naming/runtime cleanup still missing from main.
5. Avoid massive Copilot/no-merge-base branches unless cherry-picking a specific file or idea.

## Completion rule

No branch is considered handled until there is proof of one of these outcomes:

- merged into main,
- superseded by a specific main commit,
- salvaged into a new PR,
- explicitly closed/deleted as stale,
- deferred with a reason.

## Full audit reproduction

Run:

```bash
node scripts/branch-reconciliation-audit.mjs origin/main
```

