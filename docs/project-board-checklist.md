# Jarvis — Project Board Checklist

> **Source:** May 2026 Code Review · Files reviewed: `app/api/chat/route.ts`, `lib/auth.ts`, `lib/db.ts`, `lib/supabase.ts`, `middleware.ts`, `app/api/upload/route.ts`
>
> **Total findings:** 12 (2 CRITICAL · 3 HIGH · 4 MEDIUM · 2 LOW · 1 INFO)

---

## Milestone 1 — Security Hotfixes 🔴

> Fix **before any production deployment**. These items expose all users to account takeover or rate-limit bypass.

---

### [CRITICAL-1] Static session token — all users share one token

| Field | Detail |
|---|---|
| **Severity** | 🔴 CRITICAL |
| **Affected files** | `lib/auth.ts`, `middleware.ts` |
| **Status** | 📋 Todo |

**Problem:** `computeToken()` signs the fixed string `'jarvis:authenticated'` with the session secret. Every authenticated user receives an **identical** cookie. Stealing any one cookie grants permanent access as any other user; individual sessions cannot be revoked without rotating the global secret.

**Acceptance criteria:**
- [ ] `computeToken(secret, nonce)` accepts a `nonce` parameter and signs `jarvis:authenticated:<nonce>` instead of the fixed string
- [ ] Login route generates a cryptographically random nonce (`randomBytes(16).toString("hex")`) and stores it alongside the HMAC in the cookie as `<nonce>.<hmac>`
- [ ] Middleware splits the cookie on `.`, re-derives the HMAC from the stored nonce, and compares with a constant-time equality check
- [ ] Two login sessions produce two **different** cookie values
- [ ] Rotating `SESSION_SECRET` invalidates all existing sessions as expected
- [ ] *(Stretch)* Active nonces persisted in Supabase to support per-session revocation

---

### [CRITICAL-2] In-process rate limiter bypassed on every cold start

| Field | Detail |
|---|---|
| **Severity** | 🔴 CRITICAL |
| **Affected files** | `app/api/chat/route.ts` (`chatRateWindow` Map) |
| **Status** | 📋 Todo |

**Problem:** The `chatRateWindow` Map lives in module-level memory. Each serverless cold start (or new instance) resets the counter, so an attacker can exceed the per-minute limit by hammering different edge nodes. The map also grows without bound until the partial `MAX_TRACKED_CHAT_SESSIONS` cleanup runs.

**Acceptance criteria:**
- [ ] Rate-limit state stored in an external atomic store (Upstash Redis / Vercel KV) OR at minimum at a CDN/WAF layer
- [ ] `isRateLimited(sessionId)` increments an atomic counter with a 60-second TTL; count > limit returns `true`
- [ ] The in-process `chatRateWindow` Map is removed or kept only as a secondary local guard
- [ ] If Redis is not immediately available: a code comment explicitly documents the cold-start bypass limitation and CDN-level rate limiting is enabled
- [ ] Map does not grow unbounded; cleanup or TTL-based eviction is in place

---

## Milestone 2 — Reliability Hardening 🟠

> Fix **within the current sprint**. These issues can cause data leaks, unhandled crashes, or broken user-facing features.

---

### [HIGH-3] Module-level Supabase singleton leaks across requests

| Field | Detail |
|---|---|
| **Severity** | 🟠 HIGH |
| **Affected files** | `lib/supabase.ts` |
| **Status** | 📋 Todo |

**Problem:** The cached `_client` singleton is never scoped to a request. In serverless environments the same instance is reused across requests, potentially leaking authentication context. All DB writes use the ANON key with no row-level security guard at the client level.

**Acceptance criteria:**
- [ ] `getSupabaseClient()` creates a **new** client per call (no module-level caching)
- [ ] New client is created with `persistSession: false`, `autoRefreshToken: false`, `detectSessionInUrl: false`
- [ ] Row Level Security (RLS) policies enabled in Supabase dashboard so the ANON key cannot read other sessions' data
- [ ] No regression in existing DB read/write paths

---

### [HIGH-4] Untyped `catch` variables suppress error information

| Field | Detail |
|---|---|
| **Severity** | 🟠 HIGH |
| **Affected files** | `app/api/chat/route.ts` (`readRepositoryFile` tool handler and others) |
| **Status** | 📋 Todo |

**Problem:** Tool `execute` handlers catch errors as `error: any`, silencing TypeScript strict-null checks and making it easy to accidentally leak raw error objects (including stack traces or secrets) to the LLM response.

**Acceptance criteria:**
- [ ] All `catch` clauses in tool handlers use `err: unknown` instead of `error: any`
- [ ] Error message extraction follows the pattern: `const msg = err instanceof Error ? err.message : "Unknown error"`
- [ ] No raw error objects or stack traces are returned to the LLM or streamed to the client
- [ ] TypeScript strict mode reports no new errors after the change

---

### [HIGH-5] Upload endpoint is a stub — failed uploads silently block chat

| Field | Detail |
|---|---|
| **Severity** | 🟠 HIGH |
| **Affected files** | `app/api/upload/route.ts`, chat frontend component |
| **Status** | 📋 Todo |

**Problem:** The upload route always returns `501`. The chat component pastes image URLs into message content, and if the upload fails the user sees no clear error. Third-party image URLs are also forwarded directly to the OpenAI API, which is a privacy concern.

**Acceptance criteria:**
- [ ] **Option A:** Implement the upload endpoint — store images in Supabase Storage or Vercel Blob and return a signed URL; use the signed URL in the AI message
- [ ] **Option B (short-term):** Add visible UI feedback so the user knows pasting images is unsupported; failed uploads must **not** block text-only message submission
- [ ] Raw external image URLs are **not** forwarded to the model without sanitisation (see MEDIUM-8)
- [ ] Chat submission succeeds when no image is attached, regardless of upload endpoint status

---

## Milestone 3 — Input Validation & Safety 🟡

> Fix **before next minor release**. These issues can cause crashes, unexpected behaviour, or privacy leaks under adversarial or malformed input.

---

### [MEDIUM-6] Chat request body not validated — malformed input crashes handler

| Field | Detail |
|---|---|
| **Severity** | 🟡 MEDIUM |
| **Affected files** | `app/api/chat/route.ts` (POST handler) |
| **Status** | 📋 Todo |

**Problem:** The POST body is destructured with a type assertion but never validated at runtime. Sending `messages: null` or omitting the field causes an unhandled exception that skips workspace event recording and leaks a generic 500.

**Acceptance criteria:**
- [ ] A Zod (or equivalent) schema validates the full request body before any handler logic runs
- [ ] Schema enforces: `messages` is a non-empty array; `sessionId`, `conversationId`, `workspaceId`, `resumeTaskId` are optional strings/UUIDs of bounded length
- [ ] Invalid body returns HTTP 400 with `{ "error": "Invalid request body." }` before touching any state
- [ ] A 500 is no longer returned for missing or null `messages`

---

### [MEDIUM-7] `sessionId` assigned and used before validation

| Field | Detail |
|---|---|
| **Severity** | 🟡 MEDIUM |
| **Affected files** | `app/api/chat/route.ts` (POST handler, ~line 380) |
| **Status** | 📋 Todo |

**Problem:** `requestSessionId = sessionId ?? null` and a timestamp are pushed into `chatRateWindow` before checking whether `sessionId` is valid. An attacker can pollute the rate-window map with arbitrary keys.

**Acceptance criteria:**
- [ ] `sessionId` guard (type check + length check against `MAX_SESSION_ID_LENGTH`) is the **first** operation in the handler, before any map writes
- [ ] Invalid `sessionId` returns HTTP 400 immediately
- [ ] `requestSessionId` is only assigned after the guard passes
- [ ] *(Covered by MEDIUM-6 if body validation schema runs first)*

---

### [MEDIUM-8] Image URL regex allows arbitrary external URLs to AI model

| Field | Detail |
|---|---|
| **Severity** | 🟡 MEDIUM |
| **Affected files** | `app/api/chat/route.ts` (`formattedMessages` mapping) |
| **Status** | 📋 Todo |

**Problem:** The markdown image extractor accepts any `https://` URL up to 4 096 characters and forwards it to the OpenAI vision endpoint. Tracker pixels, internal metadata endpoints, or oversized images can inflate token counts or leak request data.

**Acceptance criteria:**
- [ ] An `ALLOWED_IMAGE_HOSTS` allowlist is defined (own CDN domain, Supabase Storage domain)
- [ ] `isSafeImageUrl(url)` checks `protocol === "https:"` and that `hostname` is in the allowlist
- [ ] Image blocks are only attached to the AI message if `isSafeImageUrl` returns `true`
- [ ] Disallowed URLs are either dropped silently or surfaced as a user-visible warning

---

### [MEDIUM-9] Math tokenizer accepts malformed number literals

| Field | Detail |
|---|---|
| **Severity** | 🟡 MEDIUM |
| **Affected files** | `app/api/chat/route.ts` (`tokenize` function) |
| **Status** | 📋 Todo |

**Problem:** The digit-scanning loop in `tokenize()` greedily consumes any sequence of digits and dots, so `1.2.3` is tokenized as a single `NaN` which propagates silently through the parser.

**Acceptance criteria:**
- [ ] Number scanning uses the regex `/^\d+(\.\d+)?/` instead of the greedy loop
- [ ] `1.2.3` is **not** tokenized as a single token; it either throws a parse error or is treated as two tokens separated by an operator
- [ ] Valid numbers (`42`, `3.14`, `0.5`) still parse and evaluate correctly
- [ ] `NaN` is never silently returned as a math result

---

## Milestone 4 — Cleanup & Maintainability 🔵

> Address in **backlog / next cleanup sprint**. Low risk but improve long-term maintainability.

---

### [LOW-10] `SESSION_COOKIE` constant duplicated across three files

| Field | Detail |
|---|---|
| **Severity** | 🔵 LOW |
| **Affected files** | `app/api/auth/login/route.ts`, `app/api/auth/logout/route.ts`, `middleware.ts` |
| **Status** | 📋 Todo |

**Problem:** The string `"jarvis_session"` is hardcoded in three places. A rename in one file silently breaks the others at runtime.

**Acceptance criteria:**
- [ ] `SESSION_COOKIE` is exported from a single location (e.g., `lib/auth.ts`)
- [ ] All three files import `SESSION_COOKIE` from that single source
- [ ] The literal string `"jarvis_session"` no longer appears in any file other than the single source of truth
- [ ] Build and runtime behaviour unchanged

---

### [LOW-11] Model name hardcoded — cannot change without code deploy

| Field | Detail |
|---|---|
| **Severity** | 🔵 LOW |
| **Affected files** | `app/api/chat/route.ts` |
| **Status** | 📋 Todo |

**Problem:** `openai("gpt-4o-mini")` is hardcoded. Switching to a newer or cheaper model requires a code change and full redeploy.

**Acceptance criteria:**
- [ ] Model name read from `process.env.JARVIS_CHAT_MODEL` with `"gpt-4o-mini"` as the default fallback
- [ ] `JARVIS_CHAT_MODEL` documented in `.env.example`
- [ ] No other behaviour changes

---

### [INFO-12] Streaming errors after headers are sent cannot return HTTP 5xx

| Field | Detail |
|---|---|
| **Severity** | ℹ️ INFO |
| **Affected files** | `app/api/chat/route.ts` |
| **Status** | 📋 Todo |

**Problem:** Once `result.toDataStreamResponse()` is returned the HTTP status is committed as 200. Exceptions thrown inside `onFinish` or a tool `execute` handler are silently swallowed by the AI SDK. The client cannot distinguish a clean stream-end from a mid-stream failure.

**Acceptance criteria:**
- [ ] Tool `execute` handlers are wrapped in `try/catch`; mid-stream errors are emitted as a structured error event on the stream (AI SDK `onError` callback or equivalent)
- [ ] All mid-stream exceptions are logged via `logError()` (or equivalent structured logger)
- [ ] Task failure path is updated so the UI can detect and display a retry prompt on stream error
- [ ] *(Stretch)* Integration test or manual verification that a simulated tool error surfaces in the UI rather than silently ending the stream

---

## Board Summary

| # | Severity | Title | Milestone | Status |
|---|---|---|---|---|
| 1 | 🔴 CRITICAL | Static session token | Security Hotfixes | 📋 Todo |
| 2 | 🔴 CRITICAL | In-process rate limiter bypassed on cold start | Security Hotfixes | 📋 Todo |
| 3 | 🟠 HIGH | Module-level Supabase singleton | Reliability Hardening | 📋 Todo |
| 4 | 🟠 HIGH | Untyped `catch` variables | Reliability Hardening | 📋 Todo |
| 5 | 🟠 HIGH | Upload endpoint stub / failed uploads block chat | Reliability Hardening | 📋 Todo |
| 6 | 🟡 MEDIUM | No chat body validation | Input Validation & Safety | 📋 Todo |
| 7 | 🟡 MEDIUM | `sessionId` validated after use | Input Validation & Safety | 📋 Todo |
| 8 | 🟡 MEDIUM | Permissive external image URL handling | Input Validation & Safety | 📋 Todo |
| 9 | 🟡 MEDIUM | Malformed number literals in math tokenizer | Input Validation & Safety | 📋 Todo |
| 10 | 🔵 LOW | `SESSION_COOKIE` constant duplicated | Cleanup & Maintainability | 📋 Todo |
| 11 | 🔵 LOW | Hardcoded model name | Cleanup & Maintainability | 📋 Todo |
| 12 | ℹ️ INFO | Insufficient streaming error visibility | Cleanup & Maintainability | 📋 Todo |

---

## Suggested Implementation Order

```
Sprint 1  ── CRITICAL-1, CRITICAL-2          (Security Hotfixes — block production)
Sprint 2  ── HIGH-3, HIGH-4, HIGH-5          (Reliability Hardening — current sprint)
Sprint 3  ── MEDIUM-6, MEDIUM-7, MEDIUM-8,   (Input Validation & Safety — next minor release)
             MEDIUM-9
Backlog   ── LOW-10, LOW-11, INFO-12         (Cleanup & Maintainability)
```

> **Note:** MEDIUM-7 (`sessionId` guard) is automatically resolved if MEDIUM-6 (Zod body validation schema) is implemented first, since the schema runs before any map writes.
