# Rune Architecture

Rune is Javier's private Command Center: one owner-only app for chat, project health, memory, tasks, tools, and safety-gated execution.

The product should not feel like separate systems named Builder, Workspace, Jobs, Operator, and Tools competing with each other. Those words can exist internally where needed, but the owner-facing model is simple:

1. Command Center
2. Projects
3. Tasks
4. Memory
5. Vault
6. Tools
7. Operator

## Core rule

Chat is an interface, not the whole system.

A request should flow through clear layers:

```text
UI
→ API route
→ auth/session guard
→ project resolver
→ memory/context builder
→ tool/operator router
→ execution or answer
→ task/history/audit persistence
```

## App areas

The canonical app areas live in `lib/rune-app-structure.ts`.

| Area | Purpose |
| --- | --- |
| Command Center | The single home for chat, health, project status, and active work. |
| Projects | Known apps and systems Rune manages: Rune, Unfiltr, Sports Wager Helper, and future projects. |
| Tasks | Durable operator work, queued jobs, recovery steps, and proof trails. |
| Memory | Personal, project, and decision context stored in Javier-owned infrastructure. |
| Vault | Private files, generated artifacts, and owner-only project material. |
| Tools | Read-only checks, integrations, diagnostics, and controlled utility actions. |
| Operator | Safety gates for repo control, execution, approvals, deployments, and rollback boundaries. |

## Route groups

The canonical route groups live in `lib/rune-route-map.ts`.

Current routes are not moved yet. This document defines the target organization so future refactors can be staged safely.

| Group | Current examples | Target prefix |
| --- | --- | --- |
| Auth | `/api/auth/login`, `/api/auth/logout` | `/api/auth` |
| Chat | `/api/chat`, `/api/conversations`, `/api/history` | `/api/chat` |
| Projects | `/api/app-health`, `/api/deploy-health`, `/api/app-store-connect`, `/api/revenuecat` | `/api/projects` |
| Tasks | `/api/tasks`, `/api/jobs`, `/api/runner`, `/api/actions` | `/api/tasks` |
| Memory | `/api/memory`, `/api/memory/import`, `/api/intelligence` | `/api/memory` |
| Vault | `/api/vault`, `/api/artifacts`, `/api/upload`, `/api/files/signed-url` | `/api/vault` |
| Tools | `/api/self-test`, `/api/rune-lifecycle`, `/api/plan`, `/api/push` | `/api/tools` |
| Operator | `/api/operator-briefing`, `/api/repo-actions`, `/api/app-creator-pipeline` | `/api/operator` |
| Automations | `/api/cron/*` | `/api/cron` |
| System | `/api/workspaces`, `/api/debug-crash` | `/api/system` |

## Refactor policy

Do not move API routes casually.

For any future route move:

1. Add a compatibility wrapper at the old route.
2. Keep auth behavior identical.
3. Keep response shape identical.
4. Add a smoke test for old route and new route.
5. Deploy and verify production before deleting anything.

## Naming policy

Preferred owner-facing names:

```text
Command Center
Projects
Tasks
Memory
Vault
Tools
Operator
```

Avoid adding new visible surfaces named:

```text
Builder
Workspace
Structure
Jobs
Queue
```

Those names may remain internally only when removing them would create risk. They should not be introduced in new UI copy.

## Safety policy

Rune can inspect, summarize, propose, and prepare safe changes. Mutating actions remain gated.

Never perform these without the appropriate explicit approval flow:

- merge
- production deploy
- rollback
- payment or entitlement mutation
- customer/user messaging
- secret exposure
- destructive database changes

## Current state

PR #127 established the official Command Center structure and cleaned visible labels.

PR #128 renamed Builder component names to Command Center / Projects names while intentionally leaving CSS class names stable.

This document is the next contract: a route and architecture map before any risky file movement.
