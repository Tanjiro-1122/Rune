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
