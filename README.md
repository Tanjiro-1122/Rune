# Jarvis

Jarvis is a Vercel-ready AI chatbot built with Next.js and the Vercel AI SDK, protected by a password gate so only authorized users can access it.

## Features

- Next.js App Router
- Streaming AI responses
- Simple modern dark chat interface
- Password-protected access (auth gate + session cookie)
- Ready for Vercel deployment
- Easy to customize

## Stack

- [Next.js](https://nextjs.org/) App Router
- [React](https://react.dev/) 19
- [TypeScript](https://www.typescriptlang.org/)
- [Vercel AI SDK](https://sdk.vercel.ai/)
- OpenAI (`gpt-4o-mini`)

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

Then fill in all values in `.env.local`:

```bash
# Your OpenAI API key
OPENAI_API_KEY=your_openai_api_key_here

# The password users must enter to access the app
APP_PASSWORD=your_app_password_here

# A long random secret used to sign the session cookie — keep this private
# Generate one with: openssl rand -hex 32
AUTH_SECRET=a_long_random_secret_string_here
```

> **Important:** `APP_PASSWORD` and `AUTH_SECRET` are required. Without them the login endpoint will return a 500 error.

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will be redirected to the login page — enter the password you set in `APP_PASSWORD`.

## Password Protection

Jarvis uses a lightweight password gate implemented with:

- **Next.js Middleware** — redirects unauthenticated requests to `/login`.
- **Signed session cookie** — an HMAC-SHA-256 token derived from `AUTH_SECRET` is stored as an `httpOnly` cookie (valid for 7 days).
- **Environment variables** — no secrets are hardcoded. Change `APP_PASSWORD` or `AUTH_SECRET` at any time to invalidate existing sessions.
- **Logout** — the "Sign out" button in the chat header clears the session cookie and returns you to the login page.

### Changing the password

Update `APP_PASSWORD` in your environment and redeploy (or restart the dev server). Existing sessions will be invalidated automatically if you also rotate `AUTH_SECRET`.

### Revoking all sessions

Change `AUTH_SECRET` to a new random value and redeploy.

## Project Structure

```
jarvis/
├─ app/
│  ├─ api/
│  │  ├─ auth/
│  │  │  ├─ login/
│  │  │  │  └─ route.ts     # Validates password, sets session cookie
│  │  │  └─ logout/
│  │  │     └─ route.ts     # Clears session cookie
│  │  └─ chat/
│  │     └─ route.ts        # Streaming chat API route
│  ├─ login/
│  │  └─ page.tsx           # Login page
│  ├─ globals.css            # Global styles (dark theme)
│  ├─ layout.tsx             # Root layout with metadata
│  └─ page.tsx               # Home page (protected)
├─ components/
│  └─ chat.tsx               # Chat UI component (with logout button)
├─ middleware.ts              # Route protection middleware
├─ .env.example              # Environment variable template
├─ next-env.d.ts
├─ next.config.ts
├─ package.json
└─ tsconfig.json
```

## Deploy to Vercel

1. Push this repository to GitHub.
2. Go to [vercel.com](https://vercel.com) and click **Add New Project**.
3. Import this repository.
4. Add the following environment variables in the Vercel project settings:
   - `OPENAI_API_KEY` — your OpenAI API key
   - `APP_PASSWORD` — the password to protect the app
   - `AUTH_SECRET` — a long random secret (generate with `openssl rand -hex 32`)
5. Click **Deploy**.

## Customization Ideas

- Add conversation history persistence with a database
- Add multiple AI model support
- Add markdown rendering for assistant responses
- Add file upload support
- Add voice input/output

## Notes

The API route uses `gpt-4o-mini` by default. You can change the model in `app/api/chat/route.ts`.
