# Jarvis — Setup & Deployment Guide

This guide covers everything you need to get Jarvis running locally and on Vercel, including the required Supabase schema, environment variables, and post-merge manual steps.

---

## 1. Prerequisites

- Node.js 18 or later
- An [OpenAI](https://platform.openai.com/) API key
- *(Optional)* A [Supabase](https://supabase.com) project for persistent chat history and workspaces
- *(Optional)* A [Tavily](https://tavily.com) API key for real-time web search

---

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

### Required

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key — used for chat completions and workspace retrieval embeddings |
| `APP_PASSWORD` | Password that protects the Jarvis UI |
| `SESSION_SECRET` | Long random string used to sign session cookies (e.g. `openssl rand -hex 32`) |

### Required for persistence

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | Your Supabase anon/public key |

If these are omitted Jarvis still runs in **single local workspace** mode without persistent history, files, or artifacts.

### Optional

| Variable | Default | Description |
|---|---|---|
| `TAVILY_API_KEY` | *(unset)* | Enables real-time web search via Tavily |
| `GITHUB_TOKEN` | *(unset)* | Raises GitHub API rate limit from 60 to 5 000 req/hr for public-repo analysis |
| `JARVIS_CHAT_MODEL` | `gpt-4o-mini` | OpenAI model used for chat. Change without a code redeploy. |
| `JARVIS_ALLOWED_IMAGE_HOSTS` | *(unset)* | Comma-separated list of hostnames allowed as AI vision-API image sources. Leave unset in dev; set your CDN/Supabase Storage domain in production to prevent arbitrary URLs from being forwarded to the model. |
| `JARVIS_CODE_EXECUTION_ENABLED` | `true` | Set to `false` to disable the JS/TS sandbox entirely |
| `JARVIS_CODE_TIMEOUT_MS` | `5000` | Sandbox snippet timeout (ms) |
| `JARVIS_CODE_MAX_SOURCE_LENGTH` | `10000` | Maximum snippet source length (chars) |
| `JARVIS_CODE_MAX_OUTPUT_CHARS` | `12000` | Maximum sandbox output (chars) |
| `JARVIS_CODE_MAX_ARTIFACTS` | `5` | Maximum artifacts per execution |
| `JARVIS_CODE_MAX_ARTIFACT_BYTES` | `24000` | Maximum bytes per artifact |
| `JARVIS_CODE_MEMORY_LIMIT_MB` | `64` | Sandbox worker memory limit (MB) |
| `JARVIS_CODE_MAX_WORKER_RETRIES` | `1` | Retry count for sandbox worker startup failures (clamped 0–2) |
| `JARVIS_CHAT_MAX_REQUESTS_PER_MINUTE` | `20` | Per-session chat burst limit (clamped 5–300). See the rate-limiting note below. |

> **`AUTH_SECRET`** is a legacy alias for `SESSION_SECRET` and is still accepted for backward compatibility.

---

## 3. Supabase schema

Jarvis uses Supabase for persistent workspaces, conversations, messages, documents, artifacts, and tasks. The complete schema is in [`supabase/schema.sql`](../supabase/schema.sql).

### Running the migration

1. Open your Supabase project dashboard.
2. Go to **SQL Editor → New query**.
3. Paste the entire contents of `supabase/schema.sql` and click **Run**.

The SQL is safe to re-run on an existing Jarvis installation:

- All `CREATE TABLE` statements use `IF NOT EXISTS`.
- Existing `conversations` and `messages` rows are preserved.
- Legacy conversations are backfilled into a **General workspace** if they are not already linked to one.
- Existing workspaces are backfilled into `workspace_memberships` as `owner`.

### Tables created

| Table | Purpose |
|---|---|
| `conversations` | Core chat thread record per session |
| `messages` | Individual messages in a conversation |
| `workspaces` | Project containers per browser session |
| `conversation_workspaces` | Maps each conversation into a workspace; stores `title` and activity timestamps |
| `workspace_documents` | Indexed uploaded text/code files and artifact content summaries |
| `workspace_chunks` | Retrieval chunks for semantic/lexical search |
| `workspace_artifacts` | Persisted generated artifacts with download content |
| `workspace_memberships` | Role-based workspace access (`viewer` / `editor` / `owner`) |
| `workspace_events` | Operational lifecycle log for chat/workspace activity |
| `workspace_project_files` | Normalized project-level file map linking uploads/artifacts/documents |
| `workspace_tasks` | Persisted execution tasks with progress and status for resumable flows |
| `workspace_task_steps` | Planner/executor step state for each task |

### Key columns

- `conversation_workspaces.title` — display title for a conversation in the workspace sidebar; populated on save and backfilled to `'Imported chat'` for legacy rows.

### Row Level Security (recommended for production)

The app uses the **anon key** for all Supabase operations. In a shared deployment you should enable Row Level Security (RLS) on every table so that one session cannot read another session's data. Example policy for `workspaces`:

```sql
-- Enable RLS
alter table workspaces enable row level security;

-- Each session can only see workspaces it owns
create policy "workspace owner access"
  on workspaces
  for all
  using (session_id = current_setting('request.jwt.claims', true)::json->>'sub');
```

Adapt the `session_id` condition to match how you pass the session identifier (header, JWT claim, or API parameter) depending on your auth model.

---

## 4. Local development

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with `APP_PASSWORD`.

To validate the build locally:

```bash
npm run build
```

---

## 5. Deploying to Vercel

1. **Import** the repository into Vercel.
2. In **Settings → Environment Variables**, add all variables from the table above. At minimum:
   - `OPENAI_API_KEY`
   - `APP_PASSWORD`
   - `SESSION_SECRET` (`openssl rand -hex 32` gives a good value)
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY`
3. Set **Framework Preset** to `Next.js` (auto-detected).
4. Ensure the **Node.js runtime** is selected (not Edge).
5. **Run the Supabase SQL** (step 3 above) before your first production deploy so the workspace tables exist.
6. Deploy.

> **`maxDuration`** in `app/api/chat/route.ts` is set to `60` seconds for multi-step agent work. This requires **Vercel Pro** or higher. The Hobby plan has a lower serverless function timeout; complex multi-step requests may time out on Hobby. Check the [Vercel pricing page](https://vercel.com/pricing) for the current limit for your plan.

---

## 6. Rate limiting — important production note

The built-in per-session rate limiter (`JARVIS_CHAT_MAX_REQUESTS_PER_MINUTE`) stores counters in **in-process memory**. On Vercel, each serverless cold start or new instance resets the counter independently, so the limit can be bypassed by routing requests to different instances.

**Recommended production mitigations:**

- Enable Vercel's built-in **Edge Rate Limiting** or a WAF rule at the CDN layer.
- Replace the in-process `chatRateWindow` Map in `app/api/chat/route.ts` with an external atomic store such as [Upstash Redis](https://upstash.com) or Vercel KV. The rate-limiter block is intentionally isolated in the source file to make this upgrade straightforward.

---

## 7. Post-merge manual actions

After merging this PR the following steps still require **manual action** in your external services — they cannot be applied by a code change alone:

| # | Action | Where |
|---|---|---|
| 1 | Run `supabase/schema.sql` in the SQL Editor | Supabase project |
| 2 | Set `OPENAI_API_KEY`, `APP_PASSWORD`, `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Vercel → Settings → Environment Variables |
| 3 | *(Optional)* Set `JARVIS_CHAT_MODEL` to override the chat model | Vercel env vars |
| 4 | *(Optional)* Set `JARVIS_ALLOWED_IMAGE_HOSTS` to a comma-separated list of trusted image domains | Vercel env vars |
| 5 | *(Recommended for production)* Enable Row Level Security on Supabase tables | Supabase project |
| 6 | *(Recommended for production)* Add a CDN/WAF-level rate-limiting rule or migrate the in-process limiter to Upstash Redis / Vercel KV | Vercel / Upstash |
