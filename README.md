# Jarvis — Super Agent

Jarvis is a Vercel-ready AI super-agent built with Next.js and the Vercel AI SDK. It goes beyond a basic chatbot: Jarvis plans tasks, uses tools, reasons across multiple steps, and surfaces its actions and results directly in the chat UI. Access is protected by a password gate; conversations are persisted with Supabase.

## Features

- **OpenAI tool calling** — Jarvis can call built-in tools and use the results in its response
- **Multi-step agentic execution** — up to 5 LLM steps per request for complex tasks (via `maxSteps`)
- **Task planning** — Jarvis breaks multi-step requests into a visible step-by-step plan
- **Live activity status** — the header shows which tool is running while Jarvis works
- **Calculator tool** — arithmetic, percentages, and common math functions, verified by the model
- **Date & time tool** — always-accurate current datetime, not hallucinated
- **Markdown rendering** — assistant responses render headings, lists, code blocks, bold, etc.
- **File & image uploads** — attach JPEG, PNG, GIF, WEBP images or plain-text/CSV/Markdown files
- **Persistent chat history** — messages saved per session to Supabase
- **Password-protected access** — HMAC-signed session cookie via Next.js Middleware
- **Vercel-ready** — deploys to Vercel with no additional infrastructure

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

### Multi-step execution

Jarvis uses `maxSteps: 5`, meaning a single user message can trigger up to 5 sequential LLM calls. Jarvis will plan, use tools, observe the results, and continue reasoning — all streaming back to your browser in real time.

The chat header shows a live **activity badge** with the name of the currently running tool.

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
   - `SUPABASE_URL` — Supabase project URL
   - `SUPABASE_ANON_KEY` — Supabase anon/public key
4. Deploy.

> **Note:** The default Vercel Hobby plan has a 10-second function timeout. `maxDuration` is set to **60 seconds** to allow multi-step agent execution. This requires a **Vercel Pro** plan or higher. On Hobby, single-step responses will still work normally; only long multi-step tasks may time out.

## Limitations

- **No web search** — Jarvis cannot browse the internet by default. Adding a search tool (e.g. Tavily) would require a `TAVILY_API_KEY` environment variable and a new tool definition in `app/api/chat/route.ts`.
- **No code execution** — Jarvis can write code but cannot run it server-side.
- **Binary files (PDF, DOCX)** — not supported; only images and plain-text variants are processed end-to-end.
- **Attachments not persisted** — only text content is saved to Supabase; tool call metadata and files are ephemeral.

## Customization Ideas

- Add a web search tool (Tavily / Brave Search API)
- Add more domain-specific tools (weather, stock prices, calendar)
- Enable conversation branching / multiple conversations per session
- Add voice input/output
- Expand accepted file types (PDF text extraction, DOCX parsing)
