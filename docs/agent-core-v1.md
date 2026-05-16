# Jarvis Agent Core v1

Agent Core v1 is the first quality upgrade after the Brain phase.

## Included

- Router priority fix: explicit review-only Repo Control proposal requests now outrank broad deployment wording, with UI dedupe for repeated capability cards.

- Specific tool-status labels for Repo Control/deployment stages so mobile progress cards do not repeat generic capability labels.

- Deployment control foundation: inspect Vercel deployments and prepare redeploy/rollback approval notes without mutating production.

- Controlled executor for approved proposals: runs existing safety gates and can open/track a PR, but does not merge or deploy.

- Repo-tree validation for inferred file targets: likely file guesses are checked against GitHub tree data and retargeted to closest real paths when possible.

- Owner-language tool summaries: after tool use, Jarvis should state what ran, what passed, where it stopped, and the next safe step without dumping raw JSON.

- Smart repo targeting for known projects and common feature areas, used when Repo Control proposals are created without explicit file paths.

- Deterministic router priority so self-audit/capability questions cannot fall through to calculator.
- Safer calculator routing: math requires explicit math language or a real numeric expression.
- Mandatory repository-inspection signal for app/code/error/fix requests.
- Agent Work Loop prompt section: understand → inspect → plan → propose → verify → respond.
- Chat-accessible Repo Control proposal tool that creates approval records without changing code.
- Chat-accessible `run_repo_action_stage` tool for inspect/diff/check/PR stages using existing backend gates.
- Chat-accessible `run_repo_action_ladder` tool for the safe inspect → diff → sandbox → temp-build sequence.
- Cleaner progress labels for repo inspection and proposal creation.
- Static router smoke test via `npm run test:router`.

## Still not included

- Autonomous execution of approved code changes.
- Direct deploy/rollback controls.
- Email, banking, RevenueCat, App Store Connect, or Google Play admin actions.

Those belong to later Hands/Appliances phases and must keep explicit approval gates.
