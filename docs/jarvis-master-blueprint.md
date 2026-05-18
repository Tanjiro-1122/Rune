# Jarvis Master Blueprint

**Status:** Phase 1 — Blueprint Lock  
**Owner:** Javier Huertas  
**Product:** Private Jarvis owner console  
**Rule:** Jarvis does not move to the next construction phase until the current phase is reviewed and approved as 100% complete by Javier.

---

## 1. What Jarvis is

Jarvis is Javier's private AI operating console for running, protecting, and improving his projects from one trusted place.

Jarvis is designed to become the control center for:

- Unfiltr by Javier
- SportsWager Helper
- Unfiltr Family
- Jarvis itself
- future Javier-owned projects

Jarvis should help Javier think, remember, inspect, plan, draft, verify, and execute approved actions across his apps and business systems.

Jarvis is not a public SaaS product. Jarvis is a private owner console.

---

## 2. What Jarvis is not

Jarvis is not:

- a chatbot wrapper with scattered tools
- a public product for sale
- a replacement for Javier's approval on risky actions
- an uncontrolled deployment bot
- an autonomous customer-service agent that sends messages without review
- a banking or financial action system
- a place to expose secrets, private identifiers, or raw credentials
- a system that depends on Base44 as the permanent source of private memory

Jarvis can use external platforms, but it should not be locked into them for core private context.

---

## 3. Core mission

Jarvis exists to help Javier operate with more clarity, speed, memory, and safety.

The mission is:

> Give Javier a private, secure, persistent command center that understands his projects, remembers important context, proposes safe next steps, and performs approved work with audit trails.

Every feature must serve this mission.

---

## 4. Core principles

1. **Private by default**  
   Private owner context belongs in Javier-controlled infrastructure, primarily Supabase and approved environment variables.

2. **Chat-first, not dashboard-first**  
   Phone use should feel like talking to Jarvis. Desktop may expose panels, but chat remains the lead interface.

3. **Approval before risk**  
   Code changes, deployments, emails, customer-facing messages, subscription credits, financial access, and production data changes require explicit approval.

4. **Plain English**  
   Jarvis explains findings, plans, risks, and next steps in language Javier can act on.

5. **No phase skipping**  
   Blueprint, Foundation, Framing, Systems, Interior Polish, and Advanced Capabilities must be completed in order.

6. **Auditability**  
   Important operations are logged in Supabase action/event tables.

7. **Least privilege**  
   Jarvis only receives the access needed for the current approved job.

8. **Stability before flash**  
   Voice, banking, and advanced automation wait until Blueprint, Foundation, and Framing are complete.

---

## 5. Construction phases

Jarvis is built like a house.

The order is fixed:

1. Blueprint
2. Foundation
3. Framing
4. Systems / Appliances
5. Interior Polish
6. Advanced Capabilities

A phase can only be marked complete when:

- its acceptance checklist is satisfied
- risks and known gaps are documented
- anything intentionally deferred is moved to a later phase
- Javier explicitly approves the phase as complete

---

## 6. Phase 1 — Blueprint

### Goal

Create the locked construction plan for Jarvis so future work stops drifting between ideas, infrastructure, UI, and advanced features.

### Required deliverables

- Master blueprint document exists in the repo
- Jarvis identity is defined
- Jarvis non-goals are defined
- fixed construction phases are defined
- phase gate rule is defined
- approval rules are defined
- security model is defined
- v1 scope is defined
- blocked/deferred features are defined
- Foundation checklist is defined
- Framing checklist is defined
- Systems checklist is defined
- Interior Polish checklist is defined
- Advanced Capabilities checklist is defined

### Blueprint acceptance checklist

Blueprint reaches 100% only when all are true:

- [x] Jarvis is defined as Javier's private owner console
- [x] Jarvis is explicitly not a public SaaS product
- [x] phase order is locked
- [x] no-phase-skipping rule is written
- [x] risky action approval rules are written
- [x] v1 scope is written
- [x] blocked/deferred features are written
- [x] Foundation completion checklist is written
- [x] Framing completion checklist is written
- [x] Systems completion checklist is written
- [x] Interior Polish completion checklist is written
- [x] Advanced Capabilities checklist is written
- [ ] Javier reviews this document
- [ ] Javier approves Blueprint as 100% complete

Until the final two items are complete, Jarvis remains in Phase 1.

---

## 7. Phase 2 — Foundation

### Goal

Make the underlying private infrastructure reliable before adding more rooms or advanced tools.

### Foundation includes

- Supabase persistence
- memory tables and memory event tables
- workspace persistence
- authentication and session security
- owner-memory injection
- action audit logging
- repo proposal persistence
- file upload/storage
- signed file access
- deployment health diagnostics
- task queue foundation
- runner API foundation
- schema repair strategy
- secret handling rules

### Foundation 100% checklist

Foundation reaches 100% only when all are true:

- [ ] latest unified Supabase schema is applied successfully
- [ ] `agent_memories` works for create/read/update/archive
- [ ] `agent_memory_events` logs memory actions
- [ ] `jarvis_action_events` logs significant actions
- [ ] `jarvis_repo_action_proposals` stores repo proposals
- [ ] workspace persistence works after reload
- [ ] conversation persistence works after reload
- [ ] session auth works and rejects unauthenticated access
- [ ] `SESSION_SECRET` or `AUTH_SECRET` is configured
- [ ] server-side Supabase writes use service role safely
- [ ] `RUNE_OWNER_MEMORY` or Supabase memory provides private owner context
- [ ] upload endpoint stores files without oversized chat payloads
- [ ] signed URL endpoint opens private files safely
- [ ] deploy health reports required, optional, and missing setup clearly
- [ ] task queue stores and retrieves jobs
- [ ] runner API is token-protected
- [ ] secrets are never committed or displayed
- [ ] Foundation risks and deferred work are documented
- [ ] Javier approves Foundation as 100% complete

No Framing work should continue until this checklist is complete, except emergency fixes that keep the current system usable.

---

## 8. Phase 3 — Framing

### Goal

Make the visible Jarvis structure clean, stable, and usable on phone and desktop.

### Framing includes

- chat-first interface
- mobile layout
- desktop layout
- filing cabinet / drawer model
- memory cockpit
- project switchboard
- repo control panel
- build intelligence panel
- deploy health panel
- file drawer
- activity log drawer
- tasks drawer
- reliable message rendering
- pinned composer behavior
- screenshot/image handling UI

### Framing 100% checklist

Framing reaches 100% only when all are true:

- [ ] phone UI opens directly into a clean chat-first experience
- [ ] desktop UI keeps chat primary while supporting panels
- [ ] composer stays pinned while messages scroll
- [ ] empty/blank message bubbles do not render
- [ ] screenshots can be attached without breaking chat
- [ ] memory drawer is usable and not cluttered
- [ ] repo drawer is understandable and approval-gated
- [ ] deploy health drawer clearly shows readiness
- [ ] files drawer shows stored uploads/artifacts clearly
- [ ] activity log tells the story of actions taken
- [ ] project switchboard clearly scopes Jarvis, Unfiltr, SWH, and Family
- [ ] mobile safe areas and keyboard behavior are acceptable
- [ ] no major panel pushes the main chat out of reach
- [ ] Framing risks and deferred work are documented
- [ ] Javier approves Framing as 100% complete

---

## 9. Phase 4 — Systems / Appliances

### Goal

Install practical owner workflows after the foundation and structure are stable.

### Systems include

- GitHub repo inspection and PR flow
- Vercel deployment monitoring
- active external runner execution
- customer support inbox workflow
- email read/draft/send-after-approval workflow
- RevenueCat/customer entitlement lookup
- approved subscription-credit/free-month workflow
- proactive owner brief
- app health checks
- rollback support

### Systems 100% checklist

Systems reaches 100% only when all are true:

- [ ] repo inspection works for allowlisted repos
- [ ] diff generation is review-only until approved
- [ ] sandbox checks run before execution
- [ ] temporary workspace builds run before PR/merge
- [ ] PR creation is approval-gated
- [ ] deployment checks are visible
- [ ] runner can execute allowlisted jobs safely
- [ ] email integration can read and draft safely
- [ ] sending customer email requires approval
- [ ] customer/subscription lookup is read-safe
- [ ] grants/credits require approval and audit logging
- [ ] daily owner brief can summarize projects without spam
- [ ] Systems risks and deferred work are documented
- [ ] Javier approves Systems as 100% complete

---

## 10. Phase 5 — Interior Polish

### Goal

Make Jarvis feel premium, calm, and dependable.

### Interior Polish includes

- refined mobile chat experience
- refined desktop command center
- smooth drawer behavior
- fewer noisy metrics
- clean status language
- better error handling
- better onboarding/empty states
- accessible contrast and spacing
- premium dark-glass visual direction

### Interior Polish 100% checklist

Interior Polish reaches 100% only when all are true:

- [ ] mobile chat feels natural and uncluttered
- [ ] desktop panels feel useful, not overwhelming
- [ ] error messages are clear and actionable
- [ ] loading states are calm and informative
- [ ] buttons and drawers have consistent behavior
- [ ] no critical task requires hunting through clutter
- [ ] Jarvis feels like a private command center, not a generic dashboard
- [ ] Javier approves Interior Polish as 100% complete

---

## 11. Phase 6 — Advanced Capabilities

### Goal

Add next-level interaction after the house is structurally sound.

### Advanced Capabilities include

- push-to-talk voice commands
- spoken Jarvis replies
- desktop wake mode for "Yo Jarvis" while the tab is open
- Javier voice verification / voice lock
- sensitive voice approval rules
- read-only financial cockpit
- stronger proactive monitoring
- long-running autonomous maintenance jobs

### Advanced 100% checklist

Advanced Capabilities reaches 100% only when all are true:

- [ ] voice commands work on phone and desktop with clear limits
- [ ] Jarvis can speak responses when enabled
- [ ] wake phrase is clearly limited to supported environments
- [ ] voice verification is privacy-safe
- [ ] sensitive actions still require approval
- [ ] financial integrations are read-only unless separately approved in the future
- [ ] proactive actions do not spam Javier or customers
- [ ] Javier approves Advanced Capabilities as 100% complete

---

## 12. Approval rules

Jarvis may gather facts, inspect safe sources, summarize, and draft plans without separate approval.

Jarvis must get explicit approval before:

- changing repository files
- committing code
- pushing code
- opening pull requests
- deploying production changes
- changing schemas
- sending emails or customer messages
- granting customer credits/free months/refunds
- changing subscription or entitlement state
- accessing sensitive financial information
- deleting production data
- storing new secrets
- connecting new third-party accounts

For risky actions, Jarvis follows:

1. Findings
2. Plan
3. Approval request
4. Action after approval
5. Result report
6. Audit log

---

## 13. Blocked until later

The following are blocked until Blueprint, Foundation, and Framing are complete:

- always-on wake word
- voiceprint security
- banking integrations
- autonomous email sending
- autonomous customer credits
- autonomous production deploys
- self-modifying Jarvis without proposal/approval
- public-user SaaS features

---

## 14. Jarvis v1 scope

Jarvis v1 is complete when Javier has a stable private owner console that can:

- remember important project context in Supabase
- keep work scoped by project
- accept chat-first commands
- store and view files/screenshots safely
- show deploy/configuration health
- inspect repos safely
- prepare code-change proposals
- require approval before risky work
- audit significant actions
- work reliably on iPhone and desktop

Jarvis v1 does not require:

- banking
- always-on wake word
- voiceprint
- autonomous customer support
- autonomous RevenueCat grants
- fully unsupervised development

Those belong after v1.

---

## 15. Current construction status

Current phase: **Phase 1 — Blueprint**

Current target: get Blueprint to 100% and receive Javier approval.

After approval, next phase is:

**Phase 2 — Foundation Completion Audit**

Foundation work must focus on checking and finishing the infrastructure checklist before any new Framing, Systems, Interior Polish, or Advanced Capabilities work.

---

## 16. Owner approval checkpoint

Blueprint is not complete until Javier explicitly says one of the following:

- "Blueprint approved"
- "Blueprint is 100"
- "Lock the blueprint"
- another clear approval phrase

Until then, Jarvis should treat this document as a draft blueprint under review.
