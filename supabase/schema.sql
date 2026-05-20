create extension if not exists pgcrypto;

create table if not exists conversations (
  id         uuid primary key default gen_random_uuid(),
  session_id text not null,
  created_at timestamptz default now()
);

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz default now()
);

create index if not exists conversations_session_id_created_at_idx
  on conversations(session_id, created_at desc);
create index if not exists messages_conversation_id_created_at_idx
  on messages(conversation_id, created_at);

create table if not exists workspaces (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  name        text not null,
  description text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists conversation_workspaces (
  conversation_id uuid primary key references conversations(id) on delete cascade,
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  title           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table if not exists workspace_memberships (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  session_id   text not null,
  role         text not null check (role in ('viewer', 'editor', 'owner')),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  primary key (workspace_id, session_id)
);

create table if not exists workspace_documents (
  id            uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  name          text not null,
  content_type  text not null,
  source_kind   text not null check (source_kind in ('upload', 'artifact', 'note')),
  summary       text,
  content_text  text not null,
  created_at    timestamptz default now()
);

create table if not exists workspace_chunks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  document_id  uuid not null references workspace_documents(id) on delete cascade,
  source_kind  text not null,
  source_label text not null,
  chunk_index  integer not null,
  content      text not null,
  created_at   timestamptz default now()
);

alter table workspace_chunks
  add column if not exists embedding jsonb,
  add column if not exists embedding_model text,
  add column if not exists embedding_generated_at timestamptz;

create table if not exists workspace_artifacts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  name          text not null,
  mime_type     text not null,
  content       text not null,
  bytes         integer not null,
  created_at    timestamptz default now()
);

create table if not exists workspace_events (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  session_id     text not null,
  event_type     text not null,
  status         text not null check (status in ('started', 'success', 'failure')),
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz default now()
);

create table if not exists workspace_project_files (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  document_id    uuid references workspace_documents(id) on delete set null,
  artifact_id    uuid references workspace_artifacts(id) on delete set null,
  path           text not null,
  display_name   text not null,
  source_kind    text not null check (source_kind in ('upload', 'artifact', 'note')),
  mime_type      text not null,
  bytes          integer not null default 0,
  summary        text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (workspace_id, path)
);

create table if not exists workspace_tasks (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  title          text not null,
  input_text     text not null,
  intent         text,
  status         text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress       integer not null default 0,
  result_summary text,
  error_message  text,
  resume_count   integer not null default 0,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  started_at     timestamptz,
  completed_at   timestamptz
);

create table if not exists workspace_task_steps (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references workspace_tasks(id) on delete cascade,
  step_key     text not null,
  label        text not null,
  order_index  integer not null,
  status       text not null check (status in ('pending', 'running', 'completed', 'failed')),
  detail       text,
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists workspaces_session_id_updated_at_idx
  on workspaces(session_id, updated_at desc);
create index if not exists conversation_workspaces_workspace_id_updated_at_idx
  on conversation_workspaces(workspace_id, updated_at desc);
create index if not exists workspace_documents_workspace_id_created_at_idx
  on workspace_documents(workspace_id, created_at desc);
create index if not exists workspace_chunks_workspace_id_created_at_idx
  on workspace_chunks(workspace_id, created_at desc);
create index if not exists workspace_artifacts_workspace_id_created_at_idx
  on workspace_artifacts(workspace_id, created_at desc);
create index if not exists workspace_memberships_session_id_idx
  on workspace_memberships(session_id, workspace_id);
create index if not exists workspace_events_workspace_id_created_at_idx
  on workspace_events(workspace_id, created_at desc);
create index if not exists workspace_events_event_type_created_at_idx
  on workspace_events(event_type, created_at desc);
alter table workspace_project_files
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists public_url text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists workspace_project_files_storage_path_idx
  on workspace_project_files(storage_bucket, storage_path);

create index if not exists workspace_project_files_workspace_id_updated_at_idx
  on workspace_project_files(workspace_id, updated_at desc);
alter table workspace_tasks
  add column if not exists runner_id text,
  add column if not exists runner_status text,
  add column if not exists runner_heartbeat_at timestamptz,
  add column if not exists runner_attempts integer not null default 0,
  add column if not exists runner_logs jsonb not null default '[]'::jsonb,
  add column if not exists runner_metadata jsonb not null default '{}'::jsonb;

create index if not exists workspace_tasks_runner_status_updated_at_idx
  on workspace_tasks(runner_status, updated_at desc);

create index if not exists workspace_tasks_workspace_id_updated_at_idx
  on workspace_tasks(workspace_id, updated_at desc);
create index if not exists workspace_task_steps_task_id_order_idx
  on workspace_task_steps(task_id, order_index asc);

insert into workspaces (session_id, name, description)
select distinct c.session_id, 'General workspace', 'Imported workspace for legacy Jarvis chat history.'
from conversations c
where not exists (
  select 1
  from workspaces w
  where w.session_id = c.session_id
)
on conflict do nothing;

insert into conversation_workspaces (conversation_id, workspace_id, title)
select c.id, w.id, 'Imported chat'
from conversations c
join lateral (
  select id
  from workspaces
  where session_id = c.session_id
  order by
    case when name = 'General workspace' then 0 else 1 end,
    created_at asc
  limit 1
) w on true
left join conversation_workspaces cw on cw.conversation_id = c.id
where cw.conversation_id is null
on conflict (conversation_id) do nothing;

insert into workspace_memberships (workspace_id, session_id, role)
select id, session_id, 'owner'
from workspaces
on conflict (workspace_id, session_id) do nothing;

create table if not exists jarvis_security_events (
  id            uuid primary key default gen_random_uuid(),
  event_type    text not null,
  outcome       text not null check (outcome in ('success', 'failure', 'blocked', 'info')),
  ip_address    text,
  user_agent    text,
  session_nonce text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz default now()
);

create index if not exists jarvis_security_events_created_at_idx
  on jarvis_security_events(created_at desc);
create index if not exists jarvis_security_events_event_type_created_at_idx
  on jarvis_security_events(event_type, created_at desc);
create index if not exists jarvis_security_events_outcome_created_at_idx
  on jarvis_security_events(outcome, created_at desc);

create table if not exists rune_action_events (
  id             uuid primary key default gen_random_uuid(),
  event_type     text not null,
  summary        text not null,
  status         text not null default 'info' check (status in ('proposed', 'approved', 'executed', 'blocked', 'failed', 'info')),
  approval_stage text not null default 'none' check (approval_stage in ('none', 'findings', 'plan', 'approval', 'action', 'complete')),
  risk_level     text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  project_key    text not null default 'global',
  session_id     text,
  workspace_id   uuid,
  conversation_id uuid,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz default now()
);

create index if not exists rune_action_events_created_at_idx
  on rune_action_events(created_at desc);
create index if not exists rune_action_events_project_created_at_idx
  on rune_action_events(project_key, created_at desc);
create index if not exists rune_action_events_type_created_at_idx
  on rune_action_events(event_type, created_at desc);
create index if not exists rune_action_events_status_created_at_idx
  on rune_action_events(status, created_at desc);

create table if not exists jarvis_repo_action_proposals (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  summary         text not null,
  findings        text not null default '',
  plan            text not null default '',
  repo            text not null default 'Tanjiro-1122/Jarvis',
  project_key     text not null default 'jarvis',
  risk_level      text not null default 'medium' check (risk_level in ('low', 'medium', 'high')),
  status          text not null default 'proposed' check (status in ('draft', 'proposed', 'approved', 'rejected', 'blocked', 'executed', 'cancelled')),
  files           jsonb not null default '[]'::jsonb,
  diff_preview    text not null default '',
  approval_note   text,
  draft_metadata  jsonb not null default '{}'::jsonb,
  session_id      text,
  workspace_id    uuid,
  conversation_id uuid,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  approved_at     timestamptz,
  executed_at     timestamptz
);

create index if not exists jarvis_repo_action_proposals_created_at_idx
  on jarvis_repo_action_proposals(created_at desc);
create index if not exists jarvis_repo_action_proposals_project_created_at_idx
  on jarvis_repo_action_proposals(project_key, created_at desc);
create index if not exists jarvis_repo_action_proposals_status_created_at_idx
  on jarvis_repo_action_proposals(status, created_at desc);


alter table jarvis_repo_action_proposals
  add column if not exists draft_metadata jsonb not null default '{}'::jsonb;

-- Jarvis Memory Core v1 — included in the canonical Foundation schema.
-- This block intentionally mirrors supabase/memory-core.sql so one repair script
-- can restore the complete Jarvis Foundation.
create table if not exists agent_memories (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('identity', 'owner', 'project', 'rule', 'workflow', 'decision', 'safety', 'note')),
  title text not null,
  content text not null,
  project_key text not null default 'global',
  tags text[] not null default '{}',
  priority integer not null default 5 check (priority between 1 and 10),
  is_active boolean not null default true,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (title, project_key)
);

create table if not exists agent_memory_events (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid references agent_memories(id) on delete set null,
  event_type text not null,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists agent_memories_active_priority_idx
  on agent_memories(is_active, priority desc, updated_at desc);

create index if not exists agent_memories_project_key_idx
  on agent_memories(project_key, is_active, priority desc);

create index if not exists agent_memories_tags_idx
  on agent_memories using gin(tags);

create index if not exists agent_memory_events_created_at_idx
  on agent_memory_events(created_at desc);

alter table agent_memories
  alter column project_key set default 'global';

update agent_memories
set project_key = 'global'
where project_key is null;

alter table agent_memories
  alter column project_key set not null;

-- === MEMORY VECTORS (added 2026-05-20) ===
-- Rune Deep Memory: pgvector extension + rune_memory_vectors table
-- Run this in Supabase SQL editor

-- Enable pgvector if not already enabled
create extension if not exists vector;

-- Semantic memory table with embeddings
create table if not exists rune_memory_vectors (
  id           uuid primary key default gen_random_uuid(),
  content      text not null,
  category     text default 'general',
  project      text default 'global',
  tags         text[] default '{}',
  importance   float default 0.5,
  embedding    vector(1536),
  created_at   timestamptz default now()
);

-- Index for fast cosine similarity search
create index if not exists rune_memory_vectors_embedding_idx
  on rune_memory_vectors
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists rune_memory_vectors_project_idx on rune_memory_vectors(project);
create index if not exists rune_memory_vectors_category_idx on rune_memory_vectors(category);

-- RPC function for semantic search
create or replace function match_rune_memories(
  query_embedding vector(1536),
  match_threshold float default 0.3,
  match_count     int default 8,
  filter_project  text default null,
  filter_category text default null
)
returns table (
  id          uuid,
  content     text,
  category    text,
  project     text,
  tags        text[],
  importance  float,
  created_at  timestamptz,
  similarity  float
)
language plpgsql
as $$
begin
  return query
  select
    rmv.id,
    rmv.content,
    rmv.category,
    rmv.project,
    rmv.tags,
    rmv.importance,
    rmv.created_at,
    1 - (rmv.embedding <=> query_embedding) as similarity
  from rune_memory_vectors rmv
  where
    1 - (rmv.embedding <=> query_embedding) > match_threshold
    and (filter_project is null or rmv.project = filter_project)
    and (filter_category is null or rmv.category = filter_category)
  order by rmv.embedding <=> query_embedding
  limit match_count;
end;
$$;

alter table rune_memory_vectors enable row level security;
create policy "service_role_all" on rune_memory_vectors
  for all using (true) with check (true);

-- === TASK TRACKER (added 2026-05-20) ===
create table if not exists rune_tasks (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  status          text not null default 'pending'
                  check (status in ('pending','running','completed','failed','blocked')),
  priority        text not null default 'normal'
                  check (priority in ('low','normal','high','critical')),
  project         text default 'global',
  conversation_id uuid,
  workspace_id    uuid,
  steps           jsonb,
  metadata        jsonb,
  result_summary  text,
  error           text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists rune_tasks_status_idx    on rune_tasks(status);
create index if not exists rune_tasks_project_idx   on rune_tasks(project);
create index if not exists rune_tasks_created_idx   on rune_tasks(created_at desc);
create index if not exists rune_tasks_workspace_idx on rune_tasks(workspace_id);

alter table rune_tasks enable row level security;
create policy "service_role_all" on rune_tasks
  for all using (true) with check (true);
