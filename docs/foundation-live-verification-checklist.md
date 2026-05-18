# Jarvis Foundation Live Verification Checklist

**Phase:** Foundation  
**Purpose:** Prove the Jarvis Foundation works in the deployed environment before moving to Framing.

---

## Required setup before testing

1. Run the latest `supabase/schema.sql` in Supabase SQL Editor.
2. Redeploy Jarvis on Vercel.
3. Open Jarvis in production.
4. Open Deploy Health.

---

## Live verification checklist

- [ ] Login page appears when not authenticated.
- [ ] Correct password signs in.
- [ ] Invalid password is rejected.
- [ ] Deploy Health shows `OPENAI_API_KEY`, `APP_PASSWORD`, `SESSION_SECRET`, and Supabase configured.
- [ ] Deploy Health shows all Foundation tables ready.
- [ ] Create a memory manually.
- [ ] Confirm the memory appears in the Memory drawer.
- [ ] Edit the memory.
- [ ] Archive the memory.
- [ ] Confirm `agent_memory_events` has save/update/archive rows.
- [ ] Confirm `jarvis_action_events` has related action rows.
- [ ] Create or select a workspace.
- [ ] Reload the app and confirm the workspace persists.
- [ ] Send a chat message.
- [ ] Reload the app and confirm conversation state persists.
- [ ] Attach an iPhone/desktop screenshot.
- [ ] Confirm the screenshot uploads without `FUNCTION_PAYLOAD_TOO_LARGE`.
- [ ] Confirm a `workspace_project_files` row is created for the upload.
- [ ] Open the uploaded file from the Files drawer.
- [ ] Confirm signed URL opens the stored private file.
- [ ] Create a background job/task from the UI.
- [ ] Confirm it appears in the Tasks drawer.
- [ ] Confirm task resume/retry path appears for interrupted tasks.
- [ ] Call `/api/runner` without a token and confirm it is rejected.
- [ ] Call `/api/runner` with the configured `RUNE_RUNNER_TOKEN` and confirm it can reach the runner endpoint.
- [ ] Create a repo proposal.
- [ ] Confirm the repo proposal appears in Repo Control.
- [ ] Run a local secret scan / grep to confirm no obvious secrets are committed.

---

## Approval checkpoint

Foundation is complete only after this checklist passes and Javier says:

```txt
Foundation approved
```

Until then, Jarvis stays in Phase 2 — Foundation.
