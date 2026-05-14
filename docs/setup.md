# Jarvis — Setup From Zero

This guide is written for a clean Jarvis install on Vercel with Supabase persistence.

If you only want to test locally, you can skip Supabase and Jarvis will run in single-session mode. For the real Jarvis workspace experience, set up Supabase.

---

## What Jarvis needs

Required for the app to work:

```txt
OPENAI_API_KEY
APP_PASSWORD
SESSION_SECRET
```

Required for saved workspaces, chat history, uploads, artifacts, tasks, and retrieval:

```txt
SUPABASE_URL
SUPABASE_ANON_KEY
```

Optional but recommended:

```txt
TAVILY_API_KEY
GITHUB_TOKEN
JARVIS_CODE_EXECUTION_ENABLED=true
JARVIS_CHAT_MODEL=gpt-4o-mini
JARVIS_OWNER_MEMORY=private_safe_memory_for_javier_and_his_projects
```

Important: do **not** use `NEXT_PUBLIC_` for Supabase keys in this app. Jarvis uses Supabase from server routes only.

---

## 1. Create the Supabase project

1. Go to `https://supabase.com`.
2. Sign in.
3. Click **New project**.
4. Use:

```txt
Project name: Jarvis
Database password: create a strong password and save it
Region: closest to you
```

5. Click **Create new project**.
6. Wait for Supabase to finish provisioning.

---

## 2. Get your Supabase API values

In Supabase, open your Jarvis project.

Go to:

```txt
Project Settings → API
```

Copy these two values:

```txt
Project URL
anon public key
```

You will put them in Vercel as:

```txt
SUPABASE_URL=your_project_url
SUPABASE_ANON_KEY=your_anon_public_key
```

The anon key is okay here because it stays server-side in Vercel. Do not expose it in browser/client variables.

---

## 3. Run the Jarvis database schema

In Supabase, go to:

```txt
SQL Editor → New query
```

Open this repo file:

```txt
supabase/schema.sql
```

Copy the entire file.

Paste it into Supabase SQL Editor.

Click **Run**.

The SQL is safe to run again later because it uses `create table if not exists` and safe backfill logic.

---

## 4. Confirm the tables exist

After the SQL runs, go to:

```txt
Table Editor
```

You should see these tables:

```txt
conversations
messages
workspaces
conversation_workspaces
workspace_memberships
workspace_documents
workspace_chunks
workspace_artifacts
workspace_events
workspace_project_files
workspace_tasks
workspace_task_steps
```

If you do not see these tables, the SQL did not run correctly.

---

## 5. Add Vercel environment variables

In Vercel, open the Jarvis project.

Go to:

```txt
Settings → Environment Variables
```

Add these required values:

```txt
OPENAI_API_KEY=your_openai_api_key
APP_PASSWORD=the_private_password_you_want_to_use_to_login_to_jarvis
SESSION_SECRET=a_long_random_secret_at_least_40_characters
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_public_key
```

For `SESSION_SECRET`, use a long random string. Example format:

```txt
jarvis_2026_super_long_random_secret_change_this_9f3a7b2c
```

Do not use that exact example in production. Make your own.

Recommended optional values:

```txt
TAVILY_API_KEY=your_tavily_key
GITHUB_TOKEN=your_github_token
JARVIS_CODE_EXECUTION_ENABLED=true
JARVIS_CHAT_MAX_REQUESTS_PER_MINUTE=20
JARVIS_CHAT_MODEL=gpt-4o-mini
JARVIS_OWNER_MEMORY=paste_safe_owner_memory_here
```

Optional private memory:

```txt
JARVIS_OWNER_MEMORY=paste_safe_owner_memory_here
```

Use this for curated private context about Javier, Jarvis, and active projects. Keep it in Vercel only. Do not put private memory in GitHub, README files, or client-side variables.

Optional image security setting for production:

```txt
JARVIS_ALLOWED_IMAGE_HOSTS=your-cdn.com,your-project.supabase.co
```

Leave it blank during early testing if needed.

---

## 6. Deploy again

After adding environment variables, redeploy Jarvis in Vercel.

Use:

```txt
Vercel → Deployments → Redeploy
```

or push a new commit to GitHub.

---

## 7. First login test

Open your deployed Jarvis URL.

You should land at:

```txt
/login
```

Enter the password you set in:

```txt
APP_PASSWORD
```

If login fails, check:

```txt
APP_PASSWORD
SESSION_SECRET
```

If the app opens without login in production, something is wrong. Production Jarvis requires `SESSION_SECRET` now.

---

## 8. Persistence test

After logging in:

1. Create a workspace.
2. Send a message.
3. Upload a small text file.
4. Refresh the page.
5. Confirm the workspace and chat are still there.

If the workspace disappears after refresh, check:

```txt
SUPABASE_URL
SUPABASE_ANON_KEY
supabase/schema.sql was fully run
```

---

## 9. Web search test

Ask Jarvis:

```txt
Search the web for today's AI news and summarize it.
```

If `TAVILY_API_KEY` is missing, Jarvis should explain that web search is not configured.

---

## 10. GitHub analysis test

Ask:

```txt
Analyze this repo: Tanjiro-1122/Jarvis
```

Without `GITHUB_TOKEN`, public repo analysis still works but is rate-limited by GitHub.

With `GITHUB_TOKEN`, the limit is much higher.

---

## 11. Code execution test

Ask:

```txt
Run JavaScript to calculate the compound growth of $100 at 7% for 10 years.
```

If code execution is disabled, check:

```txt
JARVIS_CODE_EXECUTION_ENABLED=true
```

Jarvis only runs sandboxed JavaScript/TypeScript snippets. It is not a full Linux terminal yet.

---

## 12. Troubleshooting

Problem: app says Supabase persistence is not configured.

Check:

```txt
SUPABASE_URL
SUPABASE_ANON_KEY
```

Problem: app says workspace tables are missing.

Fix:

```txt
Run supabase/schema.sql in Supabase SQL Editor
```

Problem: login page works locally but not Vercel.

Check:

```txt
APP_PASSWORD
SESSION_SECRET
```

Problem: OpenAI calls fail.

Check:

```txt
OPENAI_API_KEY
OpenAI billing/usage limits
```

Problem: long tasks timeout.

Jarvis currently sets the chat route max duration to 60 seconds. Some Vercel plans/runtime settings may limit this. If long tasks fail, shorten the request or upgrade the hosting/runtime setup.

---

## Production notes

Jarvis is now safer for production than local prototypes:

- Production requires `SESSION_SECRET`.
- The app is password-gated.
- Supabase is accessed server-side.
- Chat has per-session rate limiting.
- Sandbox execution has size/time/output limits.

Future hardening to consider:

- Supabase service-role server key instead of anon key for server-only DB access.
- Real user accounts instead of a single shared password.
- pgvector embeddings instead of JSONB embeddings.
- A true background worker queue for long autonomous tasks.


---

## Jarvis Memory Core

Jarvis can now store long-term memory in Supabase instead of only using the static `JARVIS_OWNER_MEMORY` environment variable.

### 1. Install the memory tables

In Supabase, open:

```txt
SQL Editor → New query
```

Copy and run the full contents of:

```txt
supabase/memory-core.sql
```

You should see:

```txt
Jarvis Memory Core schema installed
```

Then Table Editor should show:

```txt
agent_memories
agent_memory_events
```

### 2. Optional seed endpoint token

Add this Vercel environment variable so you can safely seed memory from curl without a login cookie:

```txt
JARVIS_MEMORY_SEED_TOKEN=make_a_private_random_token
```

Seeding should include this token. Keep it private.

### 3. Seed safe Saving Grace memory

After deploying this code and running the SQL, seed the safe starting memory with a POST request:

```bash
curl -X POST "https://your-jarvis-domain.vercel.app/api/memory/seed?token=YOUR_TOKEN"
```

You can also send the token as a header:

```bash
curl -X POST "https://your-jarvis-domain.vercel.app/api/memory/seed" \
  -H "x-jarvis-seed-token: YOUR_TOKEN"
```

This seeds safe memory only: Javier preferences, Unfiltr direction, repo-change approval rule, build preferences, Jarvis goal, and secret-safety rules.

### 4. Inspect memory

You can inspect active memories with:

```txt
https://your-jarvis-domain.vercel.app/api/memory
```

Search memory with:

```txt
https://your-jarvis-domain.vercel.app/api/memory?query=unfiltr
```

### 5. How chat uses memory

Every Jarvis chat request now loads relevant active memories from Supabase and injects them server-side into the system prompt.

This is the first step toward moving long-term assistant memory from Base44 into your own Supabase database.

## Build intelligence panel

Patch 4 adds a lightweight Build Intelligence panel inside Jarvis. It can inspect the Jarvis GitHub repo, latest commit, latest GitHub Actions workflow run, and optionally the latest Vercel deployment.

Add these optional Vercel environment variables if you want the panel to have full signal:

```txt
JARVIS_GITHUB_REPO=Tanjiro-1122/Jarvis
GITHUB_TOKEN=your_github_token_or_use_JARVIS_GITHUB_TOKEN
JARVIS_GITHUB_TOKEN=optional_alternative_github_token
JARVIS_VERCEL_TOKEN=your_vercel_token
JARVIS_VERCEL_PROJECT_ID=your_vercel_project_id
JARVIS_VERCEL_PROJECT_NAME=Jarvis
JARVIS_VERCEL_TEAM_ID=your_team_id_if_needed
```

GitHub inspection can work without a token for public repositories, but a token is recommended for private repos and higher rate limits.

Vercel deployment inspection requires `JARVIS_VERCEL_TOKEN` or `VERCEL_TOKEN`. If it is missing, Jarvis will simply show Vercel as optional instead of failing the app.

Every build-intelligence refresh records a low-risk `intelligence.snapshot` event in the Activity Log.

## Controlled repo actions

Patch 5 adds a Repo Control foundation for safe code-change workflows. It stores proposed repo actions in Supabase and requires explicit approval before any future execution path.

Run the latest `supabase/schema.sql` after this patch. The new table starts with:

```sql
create table if not exists jarvis_repo_action_proposals
```

This table stores:

- findings and plan
- target repo/project
- risk level
- status such as `proposed`, `approved`, `rejected`, or `executed`
- file targets and diff preview
- approval notes and timestamps

Patch 5 does **not** silently modify repositories. It creates the control and audit layer first. Future repo execution should only operate against an approved proposal and should still show Javier the exact files/diff before pushing.

## Deploy health checklist

Patch 6 adds a Deploy Health panel inside Jarvis. It checks setup readiness without exposing secret values.

The panel verifies:

- `OPENAI_API_KEY`
- `APP_PASSWORD`
- `SESSION_SECRET`
- Supabase URL/key presence
- core Supabase tables
- memory/action/repo-control tables
- optional owner memory seed
- optional GitHub token
- optional Vercel token
- GitHub/Vercel intelligence signals

Deploy Health uses:

```txt
GET /api/deploy-health
```

A health refresh also logs a low-risk `deploy_health.snapshot` event into the Activity Log.

If Deploy Health says a table is missing, run the latest `supabase/schema.sql` in Supabase SQL Editor, then redeploy or refresh Jarvis.

## Project switchboard

Patch 7 adds a Project Switchboard to the right-side Jarvis control panel. Use the **Memory** button in the top-right of Jarvis to open the panel.

The switchboard scopes controls to:

- Jarvis — `Tanjiro-1122/Jarvis`
- Unfiltr — `Tanjiro-1122/UniltrbyJavierbackup`
- SWH — `Tanjiro-1122/swhmobile`
- Unfiltr Family — `Tanjiro-1122/UnfiltrFamily`

When you switch projects, Jarvis updates the memory project filter, repo proposals, activity-log project context, and build-intelligence repo target.

This does not add a new Supabase table. It uses existing memory/action/repo proposal tables.

## Proposal-to-diff drafting

Patch 8 adds draft diff previews to Repo Control.

Use the right-side filing cabinet:

```txt
Memory button → Repo drawer → Create proposal → Draft diff
```

Drafting is intentionally safe:

- no files are changed
- no commits are pushed
- no deployment is triggered
- the proposal gets a review-only `diff_preview`
- proposed file targets are stored on the proposal
- Activity Log records `repo_action.diff_drafted`

Patch 8 adds one optional metadata column. Run latest `supabase/schema.sql`, or run this repair directly:

```sql
alter table jarvis_repo_action_proposals
  add column if not exists draft_metadata jsonb not null default '{}'::jsonb;
```


## Real Diff Inspector

Patch 9 adds a real, read-only repo file inspector to Repo Control.

Use the right-side filing cabinet:

```txt
Memory button → Repo drawer → Create/select proposal → Inspect files
```

Inspection is intentionally safe:

- reads current file contents from the selected GitHub repo
- stores file status, SHA, size, and snippets in the proposal preview
- writes a read-only inspection report into `diff_preview`
- logs `repo_action.files_inspected` in Activity Log
- does not edit files
- does not commit
- does not push
- does not deploy

This uses `GITHUB_TOKEN` or `JARVIS_GITHUB_TOKEN` server-side. No additional Supabase schema is required beyond Patch 8's `draft_metadata` column.


## Real Proposed Diff Generator

Patch 10 adds a review-only diff generator to Repo Control.

Use the right-side filing cabinet:

```txt
Memory button → Repo drawer → Create/select proposal → Generate diff
```

The generator:

- reads current file contents from GitHub
- uses `OPENAI_API_KEY` with `JARVIS_PATCH_MODEL` or `JARVIS_CHAT_MODEL`
- stores a unified proposed diff in `diff_preview`
- logs `repo_action.diff_generated` in Activity Log
- does not edit files
- does not commit
- does not push
- does not deploy

Recommended env:

```txt
OPENAI_API_KEY=...
JARVIS_PATCH_MODEL=gpt-4o-mini
```


## Controlled Execution Sandbox

Patch 11 adds a dry-run sandbox checkpoint to Repo Control.

Use the right-side filing cabinet:

```txt
Memory button → Repo drawer → Create/select proposal → Generate diff → Sandbox check
```

The sandbox check:

- parses the generated unified diff
- verifies target files against GitHub
- counts additions and deletions
- flags deletes, missing files, sensitive paths, and secret-like content
- stores a dry-run safety report in `diff_preview`
- logs `repo_action.sandbox_checked` in Activity Log
- does not edit files
- does not run builds yet
- does not commit
- does not push
- does not deploy

This is the final safety checkpoint before a future controlled execution path.


## Temporary Workspace Build Check

Patch 12 adds a controlled rehearsal step to Repo Control.

Use the right-side filing cabinet:

```txt
Memory button → Repo drawer → Create/select proposal → Generate diff → Sandbox check → Temp build
```

The temp build check:

- requires a prior sandbox check
- only runs for allowlisted repos
- clones the repo into a temporary server folder
- writes the proposed diff to a temp patch file
- runs `git apply --check`
- applies the patch locally inside the temporary folder
- runs `npm ci --ignore-scripts` when `package-lock.json` exists
- runs `npm run build --if-present`
- stores the full redacted report in `diff_preview`
- logs `repo_action.temp_workspace_checked` in Activity Log
- removes the temporary folder afterward
- does not commit
- does not push
- does not deploy

Recommended env:

```txt
JARVIS_ALLOWED_REPOS=Tanjiro-1122/Jarvis
JARVIS_SANDBOX_INSTALL_TIMEOUT_MS=180000
JARVIS_SANDBOX_BUILD_TIMEOUT_MS=180000
```


## Branch and Pull Request Approval Flow

Patch 13 adds an approved-only pull request path to Repo Control.

Use the right-side filing cabinet:

```txt
Memory button → Repo drawer → Proposal → Temp build passed → Approve → Open PR
```

The PR flow:

- requires proposal status `approved`
- requires a passing temp workspace build
- requires the repo to be allowlisted via `JARVIS_ALLOWED_REPOS`
- creates a `jarvis/<project>/<date>-<title>-<id>` branch
- applies the proposed diff to that branch
- pushes only the new branch
- opens a GitHub pull request against the default branch
- stores the PR URL/branch in `draft_metadata`
- logs `repo_action.pr_opened` in Activity Log
- does not push to `main`
- does not merge
- does not deploy

Required env:

```txt
GITHUB_TOKEN=... # or JARVIS_GITHUB_TOKEN
JARVIS_ALLOWED_REPOS=Tanjiro-1122/Jarvis
```


## PR Status and Vercel Preview Tracking

Patch 14 adds a tracking-only follow-up after Jarvis opens a pull request.

Use the right-side filing cabinet:

```txt
Memory button → Repo drawer → Proposal with PR → Track PR
```

The tracker:

- reads PR metadata from `draft_metadata`
- fetches PR state, mergeability, branch, and head SHA from GitHub
- fetches GitHub check runs and commit statuses
- optionally fetches the latest Vercel deployment for the PR branch
- stores the status report in `diff_preview`
- logs `repo_action.pr_tracked` in Activity Log
- does not change branches
- does not merge
- does not deploy

Optional Vercel env:

```txt
JARVIS_VERCEL_TOKEN=...
JARVIS_VERCEL_PROJECT_ID=...
JARVIS_VERCEL_TEAM_ID=... # only if needed
```


## Persistent Workspace Files and Image Uploads

Patch 15 replaces the old `/api/upload` stub with real Supabase Storage upload support and extends the workspace project file map.

What it enables:

- pasted screenshots upload through `/api/upload`
- uploads are stored in Supabase Storage
- signed URLs are returned to chat
- uploaded images are mapped into `workspace_project_files`
- the Files drawer can show storage path and an “Open stored file” link
- upload events are logged as `workspace_file.uploaded`

Required Vercel env:

```txt
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Optional env:

```txt
JARVIS_UPLOAD_BUCKET=jarvis-uploads
JARVIS_MAX_UPLOAD_BYTES=8388608
JARVIS_UPLOAD_SIGNED_URL_SECONDS=604800
```

Supabase schema update required:

Run the latest `supabase/schema.sql` so `workspace_project_files` has:

```txt
storage_bucket
storage_path
public_url
metadata
```

The upload route will try to create the private `jarvis-uploads` bucket automatically when using the service-role key. If your Supabase project blocks automatic bucket creation, create a private bucket named `jarvis-uploads` manually in Supabase Storage.


## File Viewer and Fresh Signed URLs

Patch 16 adds a safe file-opening layer on top of persistent workspace files.

What it enables:

- workspace uploads use collision-safe project file paths
- stored files keep permanent `storage_bucket` and `storage_path` metadata
- `/api/files/signed-url` creates a fresh Supabase signed URL on demand
- the Files drawer opens stored files through the fresh signed-url endpoint
- file opens are logged as `workspace_file.signed_url_created`
- the app no longer depends on old signed URLs staying valid forever

The endpoint is protected by Jarvis session middleware and uses the server-side Supabase service role key. It does not expose the storage service key to the browser.


## Background Job Queue

Patch 17 adds the first safe job-queue layer.

What it enables:

- Queue the current prompt as a workspace job
- Show queued/running/completed/failed jobs in the Tasks drawer
- Run a queued job through `/api/jobs`
- Persist task progress and step state in Supabase
- Log `job.queued`, `job.completed`, and `job.failed` events

Important limitation:

This is not a separate external worker yet. Patch 17 creates the queue structure and safe built-in runner endpoint, but long-running autonomous work still needs the future isolated worker patch.

Safe by design:

- no arbitrary background code execution
- no deploys
- no repo writes
- no shell commands
- only built-in low-risk queue checkpoints

Next logical patch: external/durable worker trigger or isolated runner foundation.


## Isolated Runner Foundation

Patch 18 adds the secure contract for a future external worker.

What it enables:

- `/api/runner` endpoint for external runner calls
- runner bearer-token authentication via `JARVIS_RUNNER_TOKEN`
- claim next queued job
- heartbeat an owned job
- complete an owned job
- fail an owned job
- runner metadata on `workspace_tasks`
- runner status/heartbeat/log visibility in the Tasks drawer
- audit events for runner claim/completion/failure

Required Vercel env before using an external runner:

```txt
JARVIS_RUNNER_TOKEN=your-long-random-runner-token
```

Runner API contract:

```bash
curl -X POST "https://your-jarvis-domain.vercel.app/api/runner"   -H "Authorization: Bearer $JARVIS_RUNNER_TOKEN"   -H "Content-Type: application/json"   -d '{"action":"claim","runnerId":"local-runner-1"}'
```

Heartbeat:

```bash
curl -X POST "https://your-jarvis-domain.vercel.app/api/runner"   -H "Authorization: Bearer $JARVIS_RUNNER_TOKEN"   -H "Content-Type: application/json"   -d '{"action":"heartbeat","runnerId":"local-runner-1","taskId":"TASK_ID","message":"Still working"}'
```

Complete:

```bash
curl -X POST "https://your-jarvis-domain.vercel.app/api/runner"   -H "Authorization: Bearer $JARVIS_RUNNER_TOKEN"   -H "Content-Type: application/json"   -d '{"action":"complete","runnerId":"local-runner-1","taskId":"TASK_ID","message":"Job completed"}'
```

Schema update required:

Run the latest `supabase/schema.sql` so `workspace_tasks` has:

```txt
runner_id
runner_status
runner_heartbeat_at
runner_attempts
runner_logs
runner_metadata
```

Important limitation:

Patch 18 creates the secure runner foundation, not a full autonomous remote machine. The next patch should add a concrete local/hosted runner script that polls this endpoint and performs only allowlisted actions.
