# Jarvis External Runner Spec v1

Jarvis can now queue approved CLI runner jobs, but the web app must not execute shell commands directly.

This document defines the contract for a separate trusted runner process.

## Current safety model

- Jarvis web runtime may prepare and queue CLI jobs.
- Jarvis web runtime must not call `exec`, `spawn`, or run production deployment commands for queued CLI jobs.
- A separate runner process claims queued jobs through `/api/runner` using `JARVIS_RUNNER_TOKEN`.
- Queued CLI jobs use `runner_metadata.execution_mode = "queued_only_no_local_execution"`.
- Approved deployment jobs are created only after exact approval gates pass.

## Required environment variables

Web deployment:

```txt
JARVIS_RUNNER_TOKEN=<long random bearer token>
JARVIS_DEFAULT_WORKSPACE_ID=<workspace uuid for system-queued deployment jobs>
JARVIS_DEPLOYMENT_MUTATION_MODE=cli_runner
JARVIS_VERCEL_TOKEN=<vercel token, or VERCEL_TOKEN>
```

Runner machine:

```txt
JARVIS_RUNNER_TOKEN=<same bearer token>
JARVIS_BASE_URL=https://your-jarvis-domain.vercel.app
VERCEL_TOKEN=<token used by documented Vercel CLI commands>
RUNNER_ID=trusted-runner-1
```


## Reference runner script

A conservative reference implementation lives at `scripts/trusted-runner.mjs`.

Default behavior is dry-run:

```bash
npm run runner:trusted -- --once
```

In dry-run mode, the script refuses to claim jobs unless explicitly allowed:

```bash
JARVIS_RUNNER_ALLOW_DRY_RUN_CLAIM=true npm run runner:trusted -- --once
```

Actual command execution requires all of the following:

```txt
JARVIS_RUNNER_DRY_RUN=false
JARVIS_RUNNER_EXECUTION_MODE=execute
VERCEL_TOKEN=<token>
```

The script still validates task intent, execution mode, job kind, exact deployment approval phrase, and Vercel command shape before executing anything.

## Claim loop

The external runner polls:

```bash
curl -sS -X POST "$JARVIS_BASE_URL/api/runner" \
  -H "Authorization: Bearer $JARVIS_RUNNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"claim\",\"runnerId\":\"$RUNNER_ID\"}"
```

If no task is returned, sleep and retry.

## Job shape

A CLI runner job is a normal `workspace_tasks` row with:

```txt
intent = cli_runner
runner_status = queued_for_runner
runner_metadata.job_kind = vercel_redeploy | vercel_rollback | private_app_creator_deploy | repo_check | maintenance
runner_metadata.execution_mode = queued_only_no_local_execution
runner_metadata.command = <allowlisted command>
runner_metadata.approval_text = <exact approval phrase if required>
runner_metadata.risk_level = low | medium | high
```

## Runner verification before execution

Before running anything, the external runner must verify:

1. `task.intent === "cli_runner"`
2. `runner_metadata.execution_mode === "queued_only_no_local_execution"`
3. `runner_metadata.command` starts with an allowlisted prefix.
4. For deployment jobs, `runner_metadata.approval_text` exactly matches:
   - `APPROVE JARVIS REDEPLOY`
   - `APPROVE JARVIS ROLLBACK`
   - `APPROVE PRIVATE JARVIS DEPLOY` for private App Creator dry-run validation
5. The command is one of the documented command shapes Jarvis prepared:
   - `vercel redeploy <deployment-url-or-id> --token=$VERCEL_TOKEN`
   - `vercel rollback <deployment-url-or-id> --token=$VERCEL_TOKEN`
   - `npm run private-owner-deploy -- --proposal-id=<uuid> --owner-only=true`
6. For `private_app_creator_deploy`, v1.6 is a dry-run validator only. The runner must verify:
   - `ownerOnly === true`
   - `targetAudience === "javier_only"`
   - `productionClass === "private_owner_only"`
   - `publicLaunch === false`
   - `customerFacing === false`
   - `paymentsChange === false`
   - `schemaMutation === false`
   - `authRequired === true`
   - `accessPolicy === "owner_only_authenticated_javier"`
   - `executorMode === "dry_run_validator_only"`
   - preview handoff is ready

If any check fails, the runner must call `/api/runner` with `action: "fail"` and must not execute the command. Private App Creator deploy v1.6 must call `action: "complete"` only for dry-run validation success; it must not spawn a deploy command.

## Heartbeats

During execution, the runner should send heartbeats:

```bash
curl -sS -X POST "$JARVIS_BASE_URL/api/runner" \
  -H "Authorization: Bearer $JARVIS_RUNNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"heartbeat\",\"runnerId\":\"$RUNNER_ID\",\"taskId\":\"$TASK_ID\",\"message\":\"Running approved CLI command\"}"
```

## Completion

On success:

```bash
curl -sS -X POST "$JARVIS_BASE_URL/api/runner" \
  -H "Authorization: Bearer $JARVIS_RUNNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"complete\",\"runnerId\":\"$RUNNER_ID\",\"taskId\":\"$TASK_ID\",\"message\":\"CLI runner job completed successfully\"}"
```

On failure:

```bash
curl -sS -X POST "$JARVIS_BASE_URL/api/runner" \
  -H "Authorization: Bearer $JARVIS_RUNNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"fail\",\"runnerId\":\"$RUNNER_ID\",\"taskId\":\"$TASK_ID\",\"message\":\"CLI runner job failed safely: <reason>\"}"
```

## Non-goals for v1

This spec does not add an in-app shell runner.

This spec does not let Jarvis merge PRs, deploy production, rollback production, or run arbitrary commands by itself.

The external runner is intentionally separate so production mutation requires:

1. exact owner approval,
2. queued task metadata,
3. bearer-token runner authorization,
4. external runner allowlist checks,
5. explicit result reporting.
