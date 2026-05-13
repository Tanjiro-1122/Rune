# Jarvis — Super Agent

Jarvis is a Vercel-ready AI super-agent built with Next.js and the Vercel AI SDK. It goes beyond a basic chatbot: Jarvis plans tasks, uses tools, reasons across multiple steps, and surfaces its actions and results directly in the chat UI. Access is protected by a password gate; conversations are persisted with Supabase.

## Features

- **OpenAI tool calling** — Jarvis can call built-in tools and use the results in its response
- **Multi-step agentic execution** — up to 5 LLM steps per request for complex tasks (via `maxSteps`)
- **Task planning** — Jarvis breaks multi-step requests into a visible step-by-step plan
- **Live activity status** — the header shows which tool is running while Jarvis works
- **Calculator tool** — arithmetic, percentages, and common math functions, verified by the model
- **Date & time tool** — always-accurate current datetime, not hallucinated
- **Web search** — real-time search via Tavily (requires `TAVILY_API_KEY`); surfaces direct answers and source links in the chat UI
- **GitHub repository analysis** — analyze any public repo by URL or `owner/repo`; shows metadata, README, and file tree in a visual card (optionally authenticated with `GITHUB_TOKEN`)
- **Sandboxed code execution** — run small JavaScript/TypeScript snippets with strict limits and render results, logs, errors, and text artifacts in the chat UI
- **Markdown rendering** — assistant responses render headings, lists, code blocks, bold, etc.
- **File & image uploads** — attach JPEG, PNG, GIF, WEBP images or plain-text/CSV/Markdown files
- **Persistent chat history** — messages saved per session to Supabase
- **Password-protected access** — HMAC-signed session cookie via Next.js Middleware
- **Vercel-ready** — deploys to Vercel with no additional infrastructure

## Staged Upgrade Roadmap (Base44/Emergent-inspired)

This repo keeps Jarvis branding and current integrations, and is being improved in stages toward a more capable, production-grade AI workspace experience.

### Stage 1 — Implemented in this PR

- Reliability improvements for sandbox orchestration so execution-oriented requests trigger `execute_code` more consistently.
- Stronger capability-aware prompting to prefer tool-backed execution/results over generic refusal prose.
- Structured sandbox failure handling for timeout/import/network/runtime cases, including clearer guidance.
- Better execution result UX in tool cards (clearer failure classification and remediation hints).
- Artifact flow remains via sandbox `createArtifact(...)` and is surfaced in execution result cards.

### Planned Next Stages

- **Stage 2: Professional UI refinement** — cleaner premium visual design, stronger hierarchy, better mobile polish.
- **Stage 3: Retrieval + workspace memory** — stronger context recall and higher-quality long-running task continuity.
- **Stage 4: Project/file workspaces** — richer project-scoped context and file-level workflows.
- **Stage 5: Artifact persistence + resumable tasks** — durable artifacts and resumable multi-step sessions.
- **Stage 6: Rich coding workflows** — stronger iterative coding loops and deeper developer workflows.
- **Stage 7: Safer broader execution infra** — expanded execution capabilities with stronger safety and operational controls.

## Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 15](https://nextjs.org/) App Router |
| UI | [React 19](https://react.dev/) + TypeScript |
| AI | [Vercel AI SDK 4](https://sdk.vercel.ai/) + OpenAI `gpt-4o-mini` |
| Tool schemas | [Zod](https://zod.dev/) |
| Markdown | [react-markdown](https://github.com/remarkjs/react-markdown) |
| Persistence | [Supabase](https://supabase.com/) Postgres |

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Add environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in all values in `.env.local`:

```bash
# Your OpenAI API key — required
OPENAI_API_KEY=your_openai_api_key_here

# Password users must enter to access the app — required
APP_PASSWORD=your_app_password_here

# Secret used to sign the session cookie — required
# Generate one with: openssl rand -hex 32
SESSION_SECRET=a_long_random_secret_string_here

# Supabase — optional (app works without it, history won't persist)
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Tavily — optional, enables real-time web search
# Get a free API key at https://tavily.com
TAVILY_API_KEY=

# GitHub — optional, increases GitHub API rate limit from 60 to 5000 req/hr
# Create a personal access token at https://github.com/settings/tokens (no scopes needed for public repos)
GITHUB_TOKEN=

# Sandboxed code execution — enabled by default on the Node.js runtime
JARVIS_CODE_EXECUTION_ENABLED=true

# Optional sandbox tuning
JARVIS_CODE_TIMEOUT_MS=2000
JARVIS_CODE_MAX_SOURCE_LENGTH=6000
JARVIS_CODE_MAX_OUTPUT_CHARS=8000
JARVIS_CODE_MAX_ARTIFACTS=3
JARVIS_CODE_MAX_ARTIFACT_BYTES=12000
JARVIS_CODE_MEMORY_LIMIT_MB=64
```

> `APP_PASSWORD` and `SESSION_SECRET` are required. `AUTH_SECRET` is supported as a legacy alias for `SESSION_SECRET`.

### 3. Set up Supabase (for persistent history)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** and run:

```sql
-- One conversation per browser session
create table conversations (
  id         uuid primary key default gen_random_uuid(),
  session_id text not null,
  created_at timestamptz default now()
);

-- Every user / assistant message
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz default now()
);

create index on conversations(session_id, created_at);
create index on messages(conversation_id, created_at);
```

3. In **Settings → API** copy:
   - **Project URL** → `SUPABASE_URL`
   - **`anon` / `public` key** → `SUPABASE_ANON_KEY`

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to the login page — enter the password from `APP_PASSWORD`.

## Agent Capabilities

### Built-in tools

| Tool | Description |
|---|---|
| `get_current_datetime` | Returns the real current date and time (not hallucinated) |
| `calculate` | Evaluates arithmetic, percentages, and common math functions |
| `create_task_plan` | Generates a step-by-step plan shown as a visual card before execution |
| `web_search` | Searches the web via Tavily and returns direct answers + source links |
| `analyze_github_repo` | Fetches public repo metadata, README, and file tree from GitHub |
| `execute_code` | Runs a short JavaScript/TypeScript snippet inside a constrained sandbox |

### Multi-step execution

Jarvis uses `maxSteps: 5`, meaning a single user message can trigger up to 5 sequential LLM calls. Jarvis will plan, use tools, observe the results, and continue reasoning — all streaming back to your browser in real time.

The chat header shows a live **activity badge** with the name of the currently running tool.

### Web search

When `TAVILY_API_KEY` is set Jarvis can search the web in real time. It returns a direct AI-generated answer along with source links, displayed in a search-result card in the chat. If the key is not configured, Jarvis will tell you exactly what's missing instead of giving a generic disclaimer.

Get a free Tavily API key at [tavily.com](https://tavily.com).

### GitHub repository analysis

Provide any public GitHub URL (e.g. `https://github.com/vercel/next.js`) or an `owner/repo` string. Jarvis calls `analyze_github_repo` and displays a card with:

- Repository description, language, star count, forks, license, and topics
- README content (first 4 000 characters)
- Top-level file tree

**Rate limits** — unauthenticated GitHub API requests are limited to 60/hour per IP. Set `GITHUB_TOKEN` (a personal access token with no extra scopes needed for public repos) to raise the limit to 5 000/hour. Private repositories are not accessible unless the token has the appropriate permissions.

### Sandboxed code execution

Jarvis can run short self-contained JavaScript or TypeScript snippets inside a constrained sandbox and render a tool card in chat with:

- The final returned value (`return` it explicitly from the snippet)
- `console.log` / `console.info` output
- Warnings and errors
- Text artifacts created with `createArtifact(name, content, mimeType?)`

Execution is intentionally narrow and safety-focused:

- **Small snippets only** — default source cap is `6000` characters
- **Timeout enforced** — default execution timeout is `2000 ms`
- **Resource constrained** — each run executes in an isolated worker with a configurable memory ceiling
- **No unrestricted host access** — imports, external modules, network access, filesystem access, and process access are blocked
- **Text artifacts only** — `text/*` and `application/json` artifacts are supported

Set `JARVIS_CODE_EXECUTION_ENABLED=false` if you need to turn sandboxed execution off for a deployment.

### Capability-aware responses

Jarvis gives precise, actionable responses instead of broad generic disclaimers:

- If `web_search` is unconfigured it says exactly what environment variable to add.
- If a GitHub repo is private or not found it explains why and asks for pasted content instead.
- If sandboxed execution is enabled it explains the exact sandbox limits instead of implying full project execution.
- If sandboxed execution is disabled it says exactly that the deployment has execution turned off and names `JARVIS_CODE_EXECUTION_ENABLED`.
- If a capability is genuinely absent (for example writing files outside the sandbox or sending email) it names the specific limitation and suggests the best available alternative.

### Uploading files & images

Click the **📎** button to attach one or more files. A preview appears before sending.

| Type | Extensions | Model processing |
|---|---|---|
| Images | JPEG, PNG, GIF, WEBP | ✅ Full — model sees the image |
| Plain text | `.txt`, `.csv`, `.md` | ✅ Full — text is read by the model |

- **Max file size:** 10 MB per file
- Unsupported types are rejected client-side before they reach the server

### Markdown responses

Assistant text is rendered with full Markdown support: headings, **bold**, `inline code`, fenced code blocks with syntax highlighting, numbered and bulleted lists, blockquotes, and links.

## How Persistent History Works

- On first visit a random `sessionId` UUID is created and stored in `localStorage`.
- When the chat loads, Jarvis fetches prior messages from Supabase and restores them.
- After every exchange the new user message and Jarvis's response are saved to Supabase.
- Clearing browser `localStorage` starts a fresh conversation.
- Attachments and tool-call metadata are not stored — only the final text content.

## Password Protection

- **Middleware** — Next.js Middleware redirects unauthenticated requests to `/login`.
- **Session cookie** — HMAC-SHA-256 token derived from `SESSION_SECRET`, stored `httpOnly` for 7 days.
- **Logout** — "Sign out" clears the cookie and returns to the login page.
- Rotate `SESSION_SECRET` to invalidate all existing sessions.

## Project Structure

```
jarvis/
├─ app/
│  ├─ api/
│  │  ├─ auth/
│  │  │  ├─ login/route.ts      # Validates password, sets session cookie
│  │  │  └─ logout/route.ts     # Clears session cookie
│  │  ├─ chat/route.ts          # Streaming agentic chat API (tools + maxSteps)
│  │  └─ history/route.ts       # Returns conversation history for a session
│  ├─ login/page.tsx            # Login page
│  ├─ globals.css               # Global styles (dark theme + agent UI)
│  ├─ layout.tsx                # Root layout
│  └─ page.tsx                  # Home page (protected)
├─ components/
│  └─ chat.tsx                  # Chat UI — tool cards, markdown, status badge
├─ lib/
│  ├─ auth.ts                   # Auth helpers
│  ├─ code-execution.ts         # Sandboxed JS/TS execution helpers
│  └─ supabase.ts               # Server-side Supabase client
├─ middleware.ts                 # Route protection
├─ .env.example                 # Environment variable template
├─ package.json
└─ tsconfig.json
```

## Deploy to Vercel

1. Push this repository to GitHub.
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
3. Add environment variables in the Vercel project settings:
   - `OPENAI_API_KEY` — your OpenAI API key
   - `APP_PASSWORD` — login password
   - `SESSION_SECRET` — session signing secret (`openssl rand -hex 32`)
   - `SUPABASE_URL` — Supabase project URL *(optional)*
   - `SUPABASE_ANON_KEY` — Supabase anon/public key *(optional)*
   - `TAVILY_API_KEY` — Tavily search key *(optional, enables web search)*
   - `GITHUB_TOKEN` — GitHub personal access token *(optional, higher rate limits)*
   - `JARVIS_CODE_EXECUTION_ENABLED` — optional override; set to `false` to disable sandboxed execution
   - `JARVIS_CODE_TIMEOUT_MS` — optional max runtime per snippet
   - `JARVIS_CODE_MAX_SOURCE_LENGTH` — optional source size cap
   - `JARVIS_CODE_MAX_OUTPUT_CHARS` — optional combined log/error cap
   - `JARVIS_CODE_MAX_ARTIFACTS` — optional artifact count cap
   - `JARVIS_CODE_MAX_ARTIFACT_BYTES` — optional per-artifact size cap
   - `JARVIS_CODE_MEMORY_LIMIT_MB` — optional worker memory ceiling
4. Deploy.

> **Runtime requirement:** Sandboxed code execution uses the Next.js **Node.js runtime** and Node worker threads. It is not available on the Edge runtime.
>
> **Note:** The default Vercel Hobby plan has a 10-second function timeout. `maxDuration` is set to **60 seconds** to allow multi-step agent execution. This requires a **Vercel Pro** plan or higher. On Hobby, single-step responses will still work normally; only long multi-step tasks may time out.

## Limitations

- **Web search requires TAVILY_API_KEY** — without it, Jarvis will tell you the key is missing and suggest adding it. Get a free key at [tavily.com](https://tavily.com).
- **GitHub analysis is public-only by default** — private repos require a `GITHUB_TOKEN` with appropriate permissions.
- **Sandbox scope is intentionally narrow** — execution is limited to short JavaScript/TypeScript snippets, not arbitrary repos, package installs, or full builds.
- **No external I/O in the sandbox** — network access, filesystem access, package installs, and child processes are blocked.
- **Binary files (PDF, DOCX)** — not supported; only images and plain-text variants are processed end-to-end.
- **Artifacts are text-only and ephemeral** — they render in the current response and are not persisted to Supabase.
- **Attachments not persisted** — only text content is saved to Supabase; tool call metadata and files are ephemeral.
- **GitHub API rate limit** — without `GITHUB_TOKEN`, unauthenticated requests are limited to 60/hour per IP.
