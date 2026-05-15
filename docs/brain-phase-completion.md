# Jarvis Brain Phase Completion

This document records the Brain phase foundation for Jarvis as Javier's private owner console.

## Completed Brain patches

1. **Brain Patch 1 — Project Registry**
   - Canonical projects: Jarvis, Unfiltr, SWH, Unfiltr Family.
   - Default self-repo: `Tanjiro-1122/Jarvis`.
   - Prevents guessed repo names.

2. **Brain Patch 2 — Capability Truth Layer**
   - Centralized capability snapshot in `lib/capability-truth.ts`.
   - Separates verified, configured, partial, missing setup, not connected, and approval-required items.
   - Uses Deploy Health without exposing secrets.

3. **Brain Patch 3 — Self-Audit Mode**
   - Structured self-audit in `lib/self-audit.ts`.
   - Checks identity, project map, capability truth, deploy/config health, codebase signals, safety gates, and not-connected integrations.
   - Logs audit snapshots to `jarvis_action_events`.

4. **Brain Patch 4 — Reasoning Router**
   - Expanded routing in `lib/orchestration.ts`.
   - Routes requests as answer-only, truth-check, self-audit, inspect-first, plan-first, proposal-required, approval-required, or not-connected.

5. **Brain Patch 5 — Project-Aware Memory Routing**
   - Chat memory retrieval now infers project scope from the user's message.
   - Prevents Jarvis-only context from overriding Unfiltr/SWH/Family-specific context.

## Brain phase acceptance criteria

- Jarvis knows its real identity and canonical repositories.
- Jarvis can answer capability questions from a truth layer, not vibes.
- Jarvis can self-audit and recommend the next patch.
- Jarvis routes sensitive actions through approval gates.
- Jarvis distinguishes unavailable integrations from working tools.
- Jarvis uses project-aware memory context.
- Jarvis remains a private owner console, not a SaaS product.

## Still future work

These are not Brain completion blockers; they belong to Hands/Appliances/Operations phases:

- Email/customer support connector actions.
- Banking read-only integration.
- RevenueCat/App Store/Google Play admin controls.
- Direct deploy/rollback execution.
- External runner process for long-running jobs.
- Voice interface.
- Full component refactor/polish.

## Recommended next phase

After verifying Brain patches in production, move to **Hands Phase 1 — Approval-Gated Action Executor**.

That phase should connect the reasoning router to controlled execution paths while preserving:

1. Findings.
2. Plan.
3. Explicit approval.
4. Execution.
5. Audit log.
6. Rollback/failure note.
