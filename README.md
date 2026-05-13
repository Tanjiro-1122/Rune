# Jarvis

Jarvis is a Vercel-ready AI chatbot template built with Next.js and the Vercel AI SDK.

## Features

- Next.js App Router
- Streaming AI responses
- Simple modern dark chat interface
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

Then set your API key in `.env.local`:

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
jarvis/
├─ app/
│  ├─ api/
│  │  └─ chat/
│  │     └─ route.ts      # Streaming chat API route
│  ├─ globals.css          # Global styles (dark theme)
│  ├─ layout.tsx           # Root layout with metadata
│  └─ page.tsx             # Home page
├─ components/
│  └─ chat.tsx             # Chat UI component
├─ .env.example            # Environment variable template
├─ next-env.d.ts
├─ next.config.ts
├─ package.json
└─ tsconfig.json
```

## Deploy to Vercel

1. Push this repository to GitHub.
2. Go to [vercel.com](https://vercel.com) and click **Add New Project**.
3. Import this repository.
4. Add the `OPENAI_API_KEY` environment variable in the Vercel project settings.
5. Click **Deploy**.

## File & Image Upload

Jarvis supports attaching files and images to your messages.

### How to use
Click the **📎** button in the chat input to select one or more files. A preview appears before you send. The file is sent alongside your message to the AI.

### Supported types (end-to-end)
| Type | Extensions | AI processing |
|------|-----------|--------------|
| Images | JPEG, PNG, GIF, WEBP | ✅ Full – model sees the image |
| Plain text | .txt, .csv, .md | ✅ Full – text is read by the model |
| Other binary (PDF, DOCX, …) | — | ⚠️ Not supported by `gpt-4o-mini` |

### Limits
- **Maximum file size:** 10 MB per file
- **Accepted MIME types:** `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `text/plain`, `text/csv`, `text/markdown`
- Files that exceed the size limit or have an unsupported type are rejected with a user-friendly error before being sent.

### Notes
- `gpt-4o-mini` supports image inputs natively. Images are base64-encoded in the browser and sent as multimodal content via the Vercel AI SDK's `experimental_attachments` API.
- Unsupported file types (e.g. PDFs) are blocked on the client so they never reach the server, avoiding model errors.

## Customization Ideas

- Add conversation history persistence with a database
- Add authentication
- Add multiple AI model support
- Add markdown rendering for assistant responses
- Add voice input/output

## Notes

The API route uses `gpt-4o-mini` by default. You can change the model in `app/api/chat/route.ts`.
