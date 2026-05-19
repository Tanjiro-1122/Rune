# Jarvis — AI Workspace

Jarvis is a Vercel-ready AI workspace built with Next.js and the Vercel AI SDK. It keeps the existing Jarvis branding, password gate, Supabase-backed history, uploads, web search, GitHub analysis, and sandboxed execution, while moving the product much closer to a serious workspace-oriented experience.

## What this stage implements

This stage does **not** claim exact Base44 or Emergent parity. It focuses on platform-hardening foundations needed before deeper maturity:

- **Background/resumable task infrastructure** — chat work now creates persisted workspace tasks with step-level status, progress, failure recovery, and resume support after refresh.
- **Semantic retrieval foundation** — workspace chunk retrieval now combines lexical relevance with embedding similarity for uploaded files, artifacts, and prior conversation context.
- **Deeper project workspace model** — uploaded documents + generated artifacts are mapped into a persistent workspace project-file model so context feels like one coherent environment.
- **Explicit planner/executor flow** — the backend creates a structured execution plan, tracks planner/executor phases, and surfaces consistent progress semantics across complex requests.
- **Preserved Jarvis workspace UX** — existing auth/history/uploads/web search/GitHub analysis/sandbox/artifact flows remain intact while adding task + project-depth visibility.
- **Security hardening** — stricter workspace/conversation access checks, safer sandbox blocking patterns, redacted execution errors, and request-rate usage controls.
- **Operational readiness** — sandbox worker retry controls and durable workspace event logging for request start/success/failure visibility.
- **Collaboration/admin foundation** — role-based workspace memberships (`viewer` / `editor` / `owner`) and clearer permission boundaries in workspace APIs.

## Core features retained

- Password-protected access via middleware and signed session cookie
- Supabase-backed chat history (still optional; the app can run in single-session local mode without Supabase)
- Image + plain-text uploads
- Tavily-powered web search
- GitHub repository analysis
- Sandboxed JavaScript/TypeScript execution with execution cards
- Jarvis branding and existing deployment model

## Workspace architecture

### Workspace + task data model

Jarvis keeps the original `conversations` + `messages` tables and layers new workspace tables on top:

- `workspaces` — project containers per browser session
- `conversation_workspaces` — maps each conversation into a workspace and stores its title/activity
- `workspace_documents` — indexed uploaded text/code files and artifact content summaries
- `workspace_chunks` — retrieval chunks for uploaded/project content
- `workspace_artifacts` — persistent generated artifacts with download-ready content
- `workspace_memberships` — role-based workspace access foundation (`viewer` / `editor` / `owner`)
- `workspace_events` — operational lifecycle events for chat/workspace activity visibility
- `workspace_project_files` — normalized project-level file map that links uploads/artifacts/documents into one workspace model
- `workspace_tasks` — persisted execution tasks with progress/status for resumable long-running flows
- `workspace_task_steps` — explicit planner/executor step state for each task

The schema and migration SQL live in [`supabase/schema.sql`](./supabase/schema.sql).

### Safe migration behavior

The supplied SQL is migration-safe for existing Jarvis installs:

- Existing `conversations` and `messages` are preserved
- Existing session conversations are backfilled into a default `General workspace`
- New workspace tables are created with `if not exists`
- Existing workspaces are backfilled into `workspace_memberships` as `owner`
- Legacy history remains readable even after the workspace upgrade

## Retrieval and memory behavior in this stage

Jarvis now has a stronger retrieval foundation than the original upload-only baseline:

- uploaded text/code/markdown/CSV files are persisted as indexed workspace documents
- saved artifacts are also indexed back into the workspace knowledge base
- retrieval uses chunked project content plus prior workspace conversation text
- chunk ranking combines lexical scoring with embedding similarity when `OPENAI_API_KEY` is present
- the most relevant hits are injected into the chat system prompt as retrieved workspace context

If embeddings are unavailable (missing key or upstream failure), retrieval safely falls back to lexical-only scoring.

## Tool orchestration + planner/executor improvements

Jarvis now uses stronger request routing before the model responds:

- **code execution requests** are forced toward `execute_code`
- **math-heavy requests** are forced toward `calculate`
- **date/time requests** are forced toward `get_current_datetime`
- **GitHub repo analysis requests** are forced toward `analyze_github_repo`
- **fresh/current-information requests** receive an explicit bias toward `web_search`

Planner/executor behavior is now explicit and persisted:

- planner derives a structured step list before execution starts
- execution state is persisted per workspace task (`queued` → `running` → `completed`/`failed`)
- step-level status is tracked for request capture, retrieval, execution, and persistence
- interrupted tasks are marked recoverable and can be resumed from the workspace UI

Capability messaging also remains precise:

- missing `TAVILY_API_KEY` → explicit web-search configuration message
- disabled sandbox → explicit `JARVIS_CODE_EXECUTION_ENABLED` message
- private/missing GitHub repo → precise repo limitation message
- no Supabase workspace schema → setup notice telling you to run the updated SQL

## UI/UX changes in this stage

- Left sidebar for workspaces and chat threads
- Workspace creation form and per-workspace chat list
- Right panel for persistent artifacts and indexed files
- Right panel task timeline with resumable status
- Project file mapping panel that unifies uploaded files + generated artifacts
- Workspace counts for chats, docs, and artifacts
- Cleaner, more product-style chat shell on desktop and mobile
- Improved execution/tool card presentation inside chat

## Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 15](https://nextjs.org/) App Router |
| UI | React 19 + TypeScript |
| AI | Vercel AI SDK 4 + OpenAI `gpt-4o-mini` |
| Tool schemas | Zod |
| Markdown | react-markdown |
| Persistence | Supabase Postgres |

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in the values:

```bash
OPENAI_API_KEY=your_openai_api_key_here
APP_PASSWORD=your_app_password_here
SESSION_SECRET=a_long_random_secret_string_here
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
TAVILY_API_KEY=
GITHUB_TOKEN=
JARVIS_CODE_EXECUTION_ENABLED=true

# Optional sandbox tuning — defaults shown; all values are clamped to safe ranges
JARVIS_CODE_TIMEOUT_MS=5000
JARVIS_CODE_MAX_SOURCE_LENGTH=10000
JARVIS_CODE_MAX_OUTPUT_CHARS=12000
JARVIS_CODE_MAX_ARTIFACTS=5
JARVIS_CODE_MAX_ARTIFACT_BYTES=24000
JARVIS_CODE_MEMORY_LIMIT_MB=64
JARVIS_CODE_MAX_WORKER_RETRIES=1
RUNE_CHAT_MAX_REQUESTS_PER_MINUTE=20

# Optional: override the OpenAI chat model (default: gpt-4o-mini)
RUNE_CHAT_MODEL=gpt-4o-mini

# Optional: comma-separated hostnames allowed as vision-API image sources
# Leave unset to allow any HTTPS image URL (development default)
RUNE_ALLOWED_IMAGE_HOSTS=
```

> **Required variables:** `OPENAI_API_KEY`, `APP_PASSWORD`, and `SESSION_SECRET`.
> `AUTH_SECRET` still works as a legacy alias for `SESSION_SECRET`.
>
> **Optional variables:**
> - `SUPABASE_URL` / `SUPABASE_ANON_KEY` — enables persistent workspaces, history, and artifacts
> - `TAVILY_API_KEY` — enables real-time web search
> - `GITHUB_TOKEN` — raises GitHub API rate limit from 60 to 5 000 req/hr
> - `RUNE_CHAT_MODEL` — switch chat model without a code change (default `gpt-4o-mini`)
> - `RUNE_ALLOWED_IMAGE_HOSTS` — comma-separated allowlist of image hostnames forwarded to the AI vision API; leave unset in dev, set it in production to restrict to your CDN/Supabase Storage domain
> - `JARVIS_CODE_EXECUTION_ENABLED` — set to `false` to disable the JS/TS sandbox entirely
> - `JARVIS_CODE_MAX_WORKER_RETRIES` — retries failed sandbox worker startups (clamped 0–2)
> - `RUNE_CHAT_MAX_REQUESTS_PER_MINUTE` — per-session chat burst protection (clamped 5–300)
>
> `OPENAI_API_KEY` is also used for semantic retrieval embeddings in addition to chat completions.

### 3. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor.
3. Run the contents of [`supabase/schema.sql`](./supabase/schema.sql).
4. Copy the project URL into `SUPABASE_URL`.
5. Copy the anon/public key into `SUPABASE_ANON_KEY`.

If Supabase is omitted, Jarvis still runs, but only in a **single local workspace** without persistent projects, files, or artifacts.

> For a full walkthrough — including table descriptions, the `conversation_workspaces.title` column, migration safety notes, Row Level Security guidance, and Vercel deployment details — see [`docs/setup.md`](./docs/setup.md).

### 4. Run locally

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) and sign in with `APP_PASSWORD`.

## Built-in tools

| Tool | Description |
|---|---|
| `get_current_datetime` | Returns the real current date and time |
| `calculate` | Safe arithmetic and common math functions |
| `create_task_plan` | Shows a visible plan card before multi-step work |
| `web_search` | Tavily-backed live web search |
| `analyze_github_repo` | Public GitHub repo metadata + README + tree |
| `execute_code` | Constrained JavaScript/TypeScript sandbox |

## Sandboxed execution and artifacts

Jarvis can run short self-contained JavaScript or TypeScript snippets and render:

- explicit return values
- logs and warnings
- runtime errors
- text artifacts created with `createArtifact(name, content, mimeType?)`

In this stage, artifacts are no longer response-only. They are now:

- persisted into `workspace_artifacts`
- shown in the right-hand artifacts panel
- downloadable after the original response has scrolled away
- re-indexed into workspace retrieval

Execution remains intentionally constrained:

- no imports or external packages
- no filesystem/process/network access
- strict timeout/output limits
- blocked dynamic code generation (`eval`, `Function`) and prototype mutation attempts
- supported artifact MIME types: `text/plain`, `text/csv`, `text/markdown`, `text/html`, `text/xml`, `application/json`, `application/xml`, `image/svg+xml`

Operational additions in this stage:

- sandbox worker startup failures now retry up to `JARVIS_CODE_MAX_WORKER_RETRIES`
- sandbox/runtime errors are sanitized before returning to the model/UI to reduce accidental secret leakage

## Collaboration/admin foundations in this stage

New schema additions:

- `workspace_memberships` — role assignments for future shared-workspace patterns
- `workspace_events` — durable operational event log (`started` / `success` / `failure`) for chat request visibility

Current permission model:

- workspace owners are still the creating `session_id`
- membership roles allow controlled access expansion without removing existing owner model compatibility
- API routes now enforce workspace/conversation access checks before history reads, chat execution, and artifact operations

## Operational and usage controls in this stage

- Per-session chat burst limiting (`RUNE_CHAT_MAX_REQUESTS_PER_MINUTE`) to reduce abuse/cost spikes
- Workspace event logging for request lifecycle visibility and admin troubleshooting
- Sandbox worker retry behavior for better resilience against transient worker startup failures

## Uploads and indexed content

Supported uploads remain:

| Type | Model processing |
|---|---|
| Images (`jpeg`, `png`, `gif`, `webp`) | passed through to the model |
| Plain text / code / markdown / CSV | read by the model and indexed into the workspace |

Current indexing behavior:

- text-like uploads are stored as workspace documents
- summaries and retrieval chunks are generated on the server
- artifacts are indexed the same way as uploaded text documents
- image uploads remain visible to the model during the active request, but they are **not** indexed for retrieval in this stage

## Project structure

```text
jarvis/
├─ app/
│  ├─ api/
│  │  ├─ artifacts/route.ts
│  │  ├─ auth/
│  │  ├─ chat/route.ts
│  │  ├─ conversations/route.ts
│  │  ├─ history/route.ts
│  │  └─ workspaces/route.ts
│  ├─ globals.css
│  ├─ layout.tsx
│  ├─ login/page.tsx
│  └─ page.tsx
├─ components/
│  └─ chat.tsx
├─ lib/
│  ├─ auth.ts
│  ├─ code-execution.ts
│  ├─ db.ts
│  ├─ errors.ts
│  ├─ orchestration.ts
│  ├─ supabase.ts
│  └─ workspaces.ts
├─ supabase/
│  └─ schema.sql
├─ middleware.ts
├─ .env.example
└─ package.json
```

## Deploying to Vercel

1. Import the repository into Vercel.
2. In **Settings → Environment Variables**, add all required and desired variables from `.env.example`:
   - `OPENAI_API_KEY` *(required)*
   - `APP_PASSWORD` *(required)*
   - `SESSION_SECRET` *(required — use a long random string, e.g. `openssl rand -hex 32`)*
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY` *(required for persistence)*
   - `TAVILY_API_KEY`, `GITHUB_TOKEN`, and optional tuning vars as needed
   - `RUNE_CHAT_MODEL` *(optional — defaults to `gpt-4o-mini`; set to switch models without redeploying)*
   - `RUNE_ALLOWED_IMAGE_HOSTS` *(recommended in production — comma-separated hostnames allowed as AI vision sources)*
3. Ensure the deployment uses the **Node.js runtime**.
4. Run the Supabase SQL before expecting persistent workspaces or artifacts (see [Setup guide](./docs/setup.md)).
5. Deploy.

> `maxDuration` is set to 60 seconds for multi-step agent work. Long-running tasks may require Vercel Pro or better.
>
> **Note on rate limiting:** The built-in per-session rate limiter uses in-process memory, which resets on every cold start. On Vercel, where multiple serverless instances may run concurrently, the limit can be bypassed by routing requests to different instances. For production abuse prevention, complement `RUNE_CHAT_MAX_REQUESTS_PER_MINUTE` with Vercel's edge rate limiting or a WAF rule, or replace the in-process limiter with an external atomic store (Upstash Redis / Vercel KV). See `app/api/chat/route.ts` for the isolated rate-limiter block that is designed to be upgraded.

## What remains intentionally out of scope

This stage stops short of full autonomous AI workspace parity. Intentionally **not** included yet:

- external queue/worker infrastructure beyond request-scoped execution
- PDF/DOCX ingestion pipelines and richer multimodal indexing
- full containerized multi-file build/test execution environments
- collaborative/shared workspaces across users
- full invitation flows, identity-backed RBAC, and org-level policy administration
- distributed/global rate limiting and enterprise-grade abuse prevention
- job queue dashboards, dead-letter queues, and production SLO alerting
- artifact version history or diffing
- exact Base44 or Emergent feature matching

## Future stages that would improve Jarvis further

1. **Queue-backed workers** for truly detached execution beyond request lifetimes
2. **Richer ingestion** for PDFs, DOCX, and structured parsing pipelines
3. **Broader execution breadth** (safe package install + staged build/test loops)
4. **Artifact lifecycle controls** (versioning, compare/history, richer previews)
5. **Collaboration + admin hardening** (shared workspaces, quotas, auditability)

## Validation

This repo currently uses the production build as the main validation step:

```bash
npm run build
```

There is no separate test suite in the repository today.

## Limitations

- Web search still requires `TAVILY_API_KEY`
- GitHub repo analysis is still public-repo-oriented unless `GITHUB_TOKEN` has broader access
- Sandbox execution is still intentionally narrow and cannot run arbitrary repos, installs, or external I/O
- Workspace retrieval now includes embedding-assisted ranking, but remains Postgres-backed (no dedicated vector DB yet)
- Images are not indexed into retrieval in this stage
- Supabase remains optional, but persistent workspace features require the schema in `supabase/schema.sql`


Security foundation notes live in [`docs/security.md`](./docs/security.md).
<!-- build: 1779152726 -->
