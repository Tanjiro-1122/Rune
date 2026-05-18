-- Rune Hands Phase 1: approval-gated action proposals table
-- Run this in the Supabase SQL editor for project hvvrbpvsgjxiicigkwhu

create table if not exists rune_hands_proposals (
  id              uuid primary key default gen_random_uuid(),
  action_type     text not null,
  title           text not null,
  findings        text not null default '',
  plan            text not null default '',
  gate_phrase     text not null,
  risk_level      text not null default 'medium' check (risk_level in ('low','medium','high')),
  status          text not null default 'proposed'
                    check (status in ('proposed','approved','executing','executed','failed','cancelled')),
  result_summary  text,
  rollback_note   text,
  project_key     text not null default 'global',
  session_id      uuid,
  workspace_id    uuid,
  conversation_id uuid,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  approved_at     timestamptz,
  executed_at     timestamptz
);

create index if not exists idx_rune_hands_proposals_status  on rune_hands_proposals(status);
create index if not exists idx_rune_hands_proposals_created on rune_hands_proposals(created_at desc);

-- RLS: owner-only (service role bypasses this)
alter table rune_hands_proposals enable row level security;
create policy "service role full access" on rune_hands_proposals
  using (true) with check (true);
