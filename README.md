# Jarvis — AI Workspace

Jarvis is a Vercel-ready AI workspace built with Next.js and the Vercel AI SDK. It keeps the existing Jarvis branding, password gate, Supabase-backed history, uploads, web search, GitHub analysis, and sandboxed execution, while moving the product much closer to a serious workspace-oriented experience.

## What this stage implements

This stage does **not** claim exact Base44 or Emergent parity. It focuses on platform-hardening foundations needed before deeper maturity:

- **Workspace system** — chats are grouped into named project workspaces instead of a single flat session.
- **Persistent artifacts** — sandbox `createArtifact(...)` outputs are saved per workspace, browsable in a dedicated panel, and downloadable later.
- **Indexed workspace context** — uploaded text/code/markdown/CSV documents and saved artifacts are chunked into retrieval records so Jarvis can reference prior workspace material more reliably.
- **Stronger orchestration** — routing heuristics now push clearly-supported requests down the right tool path more consistently (code execution, math, time, GitHub, current events).
- **Product-grade UI** — the app now uses a sidebar-based workspace layout with project switching, cleaner chat hierarchy, and a right-side artifacts/files panel.
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

### Workspace data model

Jarvis keeps the original `conversations` + `messages` tables and layers new workspace tables on top:

- `workspaces` — project containers per browser session
- `conversation_workspaces` — maps each conversation into a workspace and stores its title/activity
- `workspace_documents` — indexed uploaded text/code files and artifact content summaries
- `workspace_chunks` — retrieval chunks for uploaded/project content
- `workspace_artifacts` — persistent generated artifacts with download-ready content
- `workspace_memberships` — role-based workspace access foundation (`viewer` / `editor` / `owner`)
- `workspace_events` — operational lifecycle events for chat/workspace activity visibility

The schema and migration SQL live in [`supabase/schema.sql`](./supabase/schema.sql).

### Safe migration behavior

The supplied SQL is migration-safe for existing Jarvis installs:

- Existing `conversations` and `messages` are preserved
- Existing session conversations are backfilled into a default `General workspace`
- New workspace tables are created with `if not exists`
- Existing workspaces are backfilled into `workspace_memberships` as `owner`
- Legacy history remains readable even after the workspace upgrade

## Retrieval behavior in this stage

Jarvis now has a stronger retrieval foundation than the original upload-only baseline:

- uploaded text/code/markdown/CSV files are persisted as indexed workspace documents
- saved artifacts are also indexed back into the workspace knowledge base
- retrieval uses chunked project content plus prior workspace conversation text
- the most relevant hits are injected into the chat system prompt as retrieved workspace context

This is still a lightweight lexical/chunked retrieval layer — not a vector database or embedding-backed semantic search system yet.

## Tool orchestration improvements

Jarvis now uses stronger request routing before the model responds:

- **code execution requests** are forced toward `execute_code`
- **math-heavy requests** are forced toward `calculate`
- **date/time requests** are forced toward `get_current_datetime`
- **GitHub repo analysis requests** are forced toward `analyze_github_repo`
- **fresh/current-information requests** receive an explicit bias toward `web_search`

Capability messaging also remains precise:

- missing `TAVILY_API_KEY` → explicit web-search configuration message
- disabled sandbox → explicit `JARVIS_CODE_EXECUTION_ENABLED` message
- private/missing GitHub repo → precise repo limitation message
- no Supabase workspace schema → setup notice telling you to run the updated SQL

## UI/UX changes in this stage

- Left sidebar for workspaces and chat threads
- Workspace creation form and per-workspace chat list
- Right panel for persistent artifacts and indexed files
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
JARVIS_CHAT_MAX_REQUESTS_PER_MINUTE=20
```

> `APP_PASSWORD` and `SESSION_SECRET` are required. `AUTH_SECRET` still works as a legacy alias for `SESSION_SECRET`.
>
> New hardening controls were added for this stage:
> - `JARVIS_CODE_MAX_WORKER_RETRIES` — retries failed sandbox worker startups (clamped 0–2)
> - `JARVIS_CHAT_MAX_REQUESTS_PER_MINUTE` — per-session chat burst protection (clamped 5–300)

### 3. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor.
3. Run the contents of [`supabase/schema.sql`](./supabase/schema.sql).
4. Copy the project URL into `SUPABASE_URL`.
5. Copy the anon/public key into `SUPABASE_ANON_KEY`.

If Supabase is omitted, Jarvis still runs, but only in a **single local workspace** without persistent projects, files, or artifacts.

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

- Per-session chat burst limiting (`JARVIS_CHAT_MAX_REQUESTS_PER_MINUTE`) to reduce abuse/cost spikes
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
2. Add the same environment variables listed above.
3. Ensure the deployment uses the **Node.js runtime**.
4. Run the Supabase SQL before expecting persistent workspaces or artifacts.
5. Deploy.

> `maxDuration` is set to 60 seconds for multi-step agent work. Long-running tasks may require Vercel Pro or better.

## What remains intentionally out of scope

This stage stops short of full autonomous AI workspace parity. Intentionally **not** included yet:

- embeddings or vector-database retrieval
- PDF/DOCX parsing pipelines
- background jobs or resumable long-running tasks
- multi-file project execution/build environments
- collaborative/shared workspaces across users
- full invitation flows, identity-backed RBAC, and org-level policy administration
- distributed/global rate limiting and enterprise-grade abuse prevention
- job queue dashboards, dead-letter queues, and production SLO alerting
- artifact version history or diffing
- exact Base44 or Emergent feature matching

## Future stages that would improve Jarvis further

1. **Embedding-backed retrieval** for higher-quality semantic recall across large workspaces
2. **Richer document ingestion** for PDFs, DOCX, and more structured file pipelines
3. **Resumable/background tasks** for long-running coding and research jobs
4. **Deeper coding workflows** with broader execution infrastructure and multi-file iterations
5. **Artifact lifecycle tools** like versioning, compare/history, and richer previews
6. **Identity-backed collaboration** (invites, account/user model, richer RBAC, audit UX)
7. **Queue/worker scale maturity** (dead-lettering, advanced retries, cross-instance scheduling)
8. **Admin analytics + governance** (usage dashboards, quota/billing policies, alerting)

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
- Workspace retrieval is stronger than before, but not yet embedding-backed
- Images are not indexed into retrieval in this stage
- Supabase remains optional, but persistent workspace features require the schema in `supabase/schema.sql`
